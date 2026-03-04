/**
 * Excel Template Generator
 * Uses exceljs to fill Excel templates with task data
 */

const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const { getTemplatePath, getDefaultTemplatePath } = require('./templateMapper');

/**
 * Generate Excel document from template
 * @param {Object} templateData - Data mapped from database
 * @param {String} templateCode - Template code (e.g., 'WS-PM-013')
 * @param {String} assetType - Asset type (e.g., 'weather_station', 'energy_meter')
 * @returns {Buffer} - Generated Excel document buffer
 */
async function generateExcelDocument(templateData, templateCode, assetType = 'energy_meter') {
  try {
    // Get template path using mapper
    let templatePath = getTemplatePath('excel', templateCode, assetType);
    
    if (!templatePath) {
      templatePath = getDefaultTemplatePath('excel');
    }

    if (!templatePath) {
      throw new Error(`Excel template not found for template code: ${templateCode}, asset type: ${assetType}`);
    }

    // Load template workbook
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);

    // Build a flat variable map for placeholder replacement.
    // NOTE: The Energy Meter Excel template in this project uses `{placeholder}` syntax,
    // but we also support `{{placeholder}}` for consistency.
    const vars = buildExcelTemplateVars(templateData);

    // For templates like Energy Meter_Checklist.xlsx, we also need row-aware filling:
    // - Each checklist item row has an item number (e.g. 1.1) in column B
    // - Pass/Fail columns are J and K
    // - Observations placeholders appear per-row and must be filled with that row's item observations
    workbook.worksheets.forEach((worksheet) => {
      // Build map: rowNumber -> itemData (from templateData.sections) by matching item number in col B
      const rowToItem = buildRowToItemMap(worksheet, templateData);

      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
          if (typeof cell.value === 'string') {
            const original = cell.value;
            const replaced = replacePlaceholdersForCell(original, vars, {
              rowNumber,
              colNumber,
              rowToItem
            });
            if (replaced !== original) cell.value = replaced;
          } else if (cell.value && typeof cell.value === 'object' && Array.isArray(cell.value.richText)) {
            // Best-effort: join richText, replace, and write back as plain string.
            const joined = cell.value.richText.map(rt => rt.text || '').join('');
            const replaced = replacePlaceholdersForCell(joined, vars, { rowNumber, colNumber, rowToItem });
            if (replaced !== joined) cell.value = replaced;
          }
        });

        // If this row matches an item, fill pass/fail in the dedicated columns (J/K)
        const item = rowToItem.get(rowNumber);
        if (item) {
          const passCell = worksheet.getCell(`J${rowNumber}`);
          const failCell = worksheet.getCell(`K${rowNumber}`);
          passCell.value = item.status === 'pass' ? 'P' : '';
          failCell.value = item.status === 'fail' ? 'F' : '';
        }
      });
    });

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  } catch (error) {
    console.error('Error generating Excel document:', error);
    throw error;
  }
}

function buildExcelTemplateVars(templateData) {
  const safe = (v) => (v === null || v === undefined ? '' : String(v));
  const inspectionComplete = templateData?.task?.status === 'completed' || templateData?.task?.completed_at !== 'N/A';

  return {
    // Common header fields (Energy Meter template uses these)
    inspected_by: safe(templateData?.inspection?.inspected_by),
    approved_by: safe(templateData?.inspection?.approved_by),
    maintenance_team: safe(templateData?.inspection?.maintenance_team),
    inspection_date: safe(templateData?.task?.scheduled_date !== 'N/A' ? templateData?.task?.scheduled_date : templateData?.inspection?.submitted_at),
    location: safe(templateData?.asset?.location),
    inspection_complete: inspectionComplete ? 'YES' : 'NO',
    start_hour: safe(templateData?.task?.start_hour),
    finished_hour: safe(templateData?.task?.finished_hour),
    // Template compatibility aliases (you requested these placeholders)
    started_at: safe(templateData?.task?.start_hour),   // time task started
    finished_at: safe(templateData?.task?.finished_hour), // time task ended
    last_revision_date: safe(templateData?.template?.last_revision_date),
    checklist_made_by: safe(templateData?.template?.checklist_made_by),
    last_revision_approved_by: safe(templateData?.template?.last_revision_approved_by),

    // Observations blocks
    final_observations: safe(templateData?.observations),

    // Useful extras (if the Excel template later adds them)
    plant_name: safe(templateData?.plant_name),
    procedure: safe(templateData?.procedure),
    task_code: safe(templateData?.task?.code),
    task_type: safe(templateData?.task?.type),
    asset_name: safe(templateData?.asset?.name),
    asset_code: safe(templateData?.asset?.code),

    // Common alternates/synonyms (so the template can use simpler names)
    date: safe(templateData?.task?.scheduled_date !== 'N/A' ? templateData?.task?.scheduled_date : templateData?.inspection?.submitted_at),
    submitted_by: safe(templateData?.inspection?.submitted_by),
    submitted_at: safe(templateData?.inspection?.submitted_at)
  };
}

function replacePlaceholdersForCell(text, vars, ctx) {
  if (!text || typeof text !== 'string') return text;

  // Row-aware: `{observations}` should resolve to the matched item's observation on that row (if any)
  if (text.includes('{observations}') || text.includes('{{observations}}')) {
    const item = ctx?.rowToItem?.get(ctx.rowNumber);
    const obs = item?.observations ? String(item.observations) : '';
    text = text.replaceAll('{observations}', obs).replaceAll('{{observations}}', obs);
  }

  // Row-aware pass/fail placeholders (if you add them into the Excel template)
  // - {pass} or {{pass}} becomes 'P' when item passed, else blank
  // - {fail} or {{fail}} becomes 'F' when item failed, else blank
  if (
    text.includes('{pass}') || text.includes('{{pass}}') ||
    text.includes('{fail}') || text.includes('{{fail}}')
  ) {
    const item = ctx?.rowToItem?.get(ctx.rowNumber);
    const passVal = item?.status === 'pass' ? 'P' : '';
    const failVal = item?.status === 'fail' ? 'F' : '';
    text = text
      .replaceAll('{pass}', passVal).replaceAll('{{pass}}', passVal)
      .replaceAll('{fail}', failVal).replaceAll('{{fail}}', failVal);
  }

  // Generic replacement for `{key}` and `{{key}}`
  for (const [key, value] of Object.entries(vars)) {
    const v = value === null || value === undefined ? '' : String(value);
    text = text.replaceAll(`{${key}}`, v).replaceAll(`{{${key}}}`, v);
  }

  return text;
}

function buildRowToItemMap(worksheet, templateData) {
  const map = new Map();

  // Build quick lookup: "1.1" -> itemData
  const numberToItem = new Map();
  (templateData?.sections || []).forEach(section => {
    (section.items || []).forEach(item => {
      if (item?.number) numberToItem.set(String(item.number), item);
    });
  });

  // In Energy Meter template, item numbers are in column B (e.g. B13 = 1.1)
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const raw = row.getCell(2).value; // column B
    const val = typeof raw === 'string' ? raw.trim() : (typeof raw === 'number' ? String(raw) : '');
    if (!val) return;

    // Only match "x.y" style numbers for checklist items
    if (!/^\d+\.\d+$/.test(val)) return;

    const item = numberToItem.get(val);
    if (item) map.set(rowNumber, item);
  });

  return map;
}

module.exports = {
  generateExcelDocument
};

