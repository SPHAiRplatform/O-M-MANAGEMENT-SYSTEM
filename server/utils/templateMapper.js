/**
 * Template Mapper
 * Maps template codes to actual template file paths
 * Handles different asset types and task types
 */

const path = require('path');
const fs = require('fs');

/**
 * Get template file path for a given format and template code
 * @param {String} format - 'word' or 'excel'
 * @param {String} templateCode - Template code (e.g., 'WS-PM-013')
 * @param {String} assetType - Asset type (e.g., 'weather_station', 'energy_meter')
 * @returns {String|null} - Path to template file or null if not found
 */
function getTemplatePath(format, templateCode, assetType) {
  const formatDir = format === 'word' ? 'word' : 'excel';
  const ext = format === 'word' ? 'docx' : 'xlsx';
  
  // Priority order for template lookup:
  // 1. Template-specific file in server/templates/{format}/
  // 2. Asset-type specific file
  // 3. Known template filename fallback (ONLY when it matches this asset/template)
  // 4. Fallback to Checksheets directory (scoped to the same asset/template; never cross-pollinate)
  
  const searchPaths = [];

  // 1) Template-code specific (highest priority)
  searchPaths.push(
    path.join(__dirname, '../templates', formatDir, `${templateCode}.${ext}`),
    path.join(__dirname, '../../Checksheets', formatDir, `${templateCode}.${ext}`),
    path.join(__dirname, '../../Checksheets', `${templateCode}.${ext}`)
  );

  // 2) Asset-type specific
  searchPaths.push(
    path.join(__dirname, '../templates', formatDir, `${assetType}.${ext}`),
    path.join(__dirname, '../../Checksheets', formatDir, `${assetType}.${ext}`)
  );

  const normalizedAssetType = (assetType || '').toLowerCase();
  const normalizedCode = (templateCode || '').toUpperCase();

  // 3) Known filename fallback, but ONLY for the matching asset/template family.
  //
  // Prevents a critical bug:
  // - Energy Meter (Excel) tasks accidentally resolving to Weather Station (Word) templates
  //   which then makes the report download return a Word document instead of Excel.
  const isWeatherStationFamily = normalizedAssetType === 'weather_station' || normalizedCode.startsWith('WS-');
  const isEnergyMeterFamily = normalizedAssetType === 'energy_meter' || normalizedCode.startsWith('EM-');

  if (format === 'word' && isWeatherStationFamily) {
    searchPaths.push(
      path.join(__dirname, '../templates/word', 'WEATHER STATION.docx'),
      path.join(__dirname, '../../Checksheets/word', 'WEATHER STATION.docx'),
      path.join(__dirname, '../../Checksheets', 'WEATHER STATION.docx')
    );
  }

  if (format === 'excel' && isEnergyMeterFamily) {
    searchPaths.push(
      path.join(__dirname, '../templates/excel', 'Energy Meter_Checklist.xlsx'),
      path.join(__dirname, '../../Checksheets/excel', 'Energy Meter_Checklist.xlsx'),
      path.join(__dirname, '../../Checksheets', 'Energy Meter_Checklist.xlsx')
    );
  }

  // Find first existing template from explicit paths
  for (const templatePath of searchPaths) {
    if (fs.existsSync(templatePath)) {
      console.log(`Found template: ${templatePath}`);
      return templatePath;
    }
  }

  // 4) Fuzzy match: scan template directories for files containing the asset type name
  //    This handles asset types like scada, cctv, inverter, tracker, substation, etc.
  //    without needing explicit mappings for each one.
  if (normalizedAssetType) {
    const fuzzyDirs = [
      path.join(__dirname, `../templates/${formatDir}`),
      path.join(__dirname, `../../Checksheets/${formatDir}`),
      path.join(__dirname, '../../Checksheets')
    ];

    // Build search terms from asset type (e.g., "scada" -> ["scada"], "energy_meter" -> ["energy", "meter"])
    const searchTerms = normalizedAssetType.split(/[_\-\s]+/).filter(t => t.length > 2);

    for (const dir of fuzzyDirs) {
      if (!fs.existsSync(dir)) continue;
      try {
        const files = fs.readdirSync(dir).filter(f => f.endsWith(`.${ext}`));
        for (const file of files) {
          const normalizedFile = file.toLowerCase();
          // Match if ALL search terms appear in the filename
          if (searchTerms.every(term => normalizedFile.includes(term))) {
            const matched = path.join(dir, file);
            console.log(`Found template (fuzzy match): ${matched}`);
            return matched;
          }
        }
        // Fallback: match if ANY search term appears
        for (const file of files) {
          const normalizedFile = file.toLowerCase();
          if (searchTerms.some(term => normalizedFile.includes(term))) {
            const matched = path.join(dir, file);
            console.log(`Found template (partial match): ${matched}`);
            return matched;
          }
        }
      } catch (e) {
        // Directory read error, skip
      }
    }
  }

  return null;
}

/**
 * Get default template path if specific template not found
 */
function getDefaultTemplatePath(format) {
  if (format === 'word') {
    const defaultPaths = [
      path.join(__dirname, '../templates/word/WEATHER STATION.docx'),
      path.join(__dirname, '../../Checksheets/word/WEATHER STATION.docx'),
      path.join(__dirname, '../../Checksheets/WEATHER STATION.docx')
    ];
    
    for (const p of defaultPaths) {
      if (fs.existsSync(p)) return p;
    }
  } else {
    const defaultPaths = [
      path.join(__dirname, '../templates/excel/Energy Meter_Checklist.xlsx'),
      path.join(__dirname, '../../Checksheets/excel/Energy Meter_Checklist.xlsx')
    ];
    
    for (const p of defaultPaths) {
      if (fs.existsSync(p)) return p;
    }
  }
  
  return null;
}

module.exports = {
  getTemplatePath,
  getDefaultTemplatePath
};

