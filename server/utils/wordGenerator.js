/**
 * Word Template Generator
 * Uses docxtemplater to fill Word templates with task data
 */

const Docxtemplater = require('docxtemplater');
const PizZip = require('pizzip');
const fs = require('fs');
const path = require('path');
const { getTemplatePath, getDefaultTemplatePath } = require('./templateMapper');
const { inspectWordTemplate } = require('./templateInspector');

/**
 * Generate Word document from template
 * @param {Object} templateData - Data mapped from database
 * @param {String} templateCode - Template code (e.g., 'WS-PM-013')
 * @param {String} assetType - Asset type (e.g., 'weather_station')
 * @returns {Buffer} - Generated Word document buffer
 */
function generateWordDocument(templateData, templateCode, assetType = 'weather_station') {
  try {
    // Get template path using mapper
    let templatePath = getTemplatePath('word', templateCode, assetType);
    
    if (!templatePath) {
      templatePath = getDefaultTemplatePath('word');
    }

    if (!templatePath) {
      throw new Error(`Word template not found for template code: ${templateCode}, asset type: ${assetType}`);
    }

    // Inspect template for placeholders (for debugging)
    const templatePlaceholders = inspectWordTemplate(templatePath);
    console.log(`Template placeholders found (${templatePlaceholders.length}):`, templatePlaceholders);
    
    if (templatePlaceholders.length === 0) {
      console.warn('⚠️ WARNING: No placeholders found in Word template!');
      console.warn('The template must contain {{placeholders}} for data to be inserted.');
      console.warn('Example placeholders: {{plant_name}}, {{task_code}}, {{asset_name}}, {{inspected_by}}');
      console.warn('For sections/items, use: {{#sections}}...{{/sections}}');
    }

    // Load template
    const content = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: {
        start: '{{',
        end: '}}'
      }
    });

    // Prepare data for template
    // docxtemplater uses {{variable}} syntax
    const templateVars = {
      plant_name: templateData.plant_name || '',
      procedure: templateData.procedure || '',
      task_code: templateData.task?.code || '',
      task_type: templateData.task?.type || '',
      asset_name: templateData.asset?.name || '',
      asset_code: templateData.asset?.code || '',
      location: templateData.asset?.location || '',
      scheduled_date: templateData.task?.scheduled_date || '',
      completed_date: templateData.task?.completed_date || '',
      start_hour: templateData.task?.start_hour || '',
      finished_hour: templateData.task?.finished_hour || '',
      // Template compatibility aliases (you requested these placeholders)
      started_at: templateData.task?.start_hour || '',   // time task started
      finished_at: templateData.task?.finished_hour || '', // time task ended
      last_revision_date: templateData.template?.last_revision_date || '',
      checklist_made_by: templateData.template?.checklist_made_by || '',
      last_revision_approved_by: templateData.template?.last_revision_approved_by || '',
      maintenance_team: templateData.inspection?.maintenance_team || '',
      inspected_by: templateData.inspection?.inspected_by || '',
      approved_by: templateData.inspection?.approved_by || '',
      submitted_by: templateData.inspection?.submitted_by || '',
      submitted_at: templateData.inspection?.submitted_at || '',
      inspection_time: templateData.inspection?.submitted_at || '', // Alias for template compatibility
      overall_status: templateData.task?.overall_status || '',
      observations: templateData.observations || '',
      
      // Sections array for looping in template
      sections: (templateData.sections || []).map(section => ({
        number: section.number || 0,
        title: section.title || '',
        items: (section.items || []).map(item => {
          const isPass = item.status === 'pass';
          const isFail = item.status === 'fail';
          
          return {
            number: item.number || '',
            label: item.label || '',
            status: item.status || '',
            // Pass column: Show 'P' if pass, blank if fail
            status_pass: isPass ? 'P' : '',
            st_p: isPass ? 'P' : '', // Short alias
            status_pass_text: isPass ? '✓' : '',
            // Fail column: Show 'F' if fail, blank if pass
            status_fail: isFail ? 'F' : '',
            st_f: isFail ? 'F' : '', // Short alias
            status_fail_text: isFail ? '✗' : '',
            observations: item.observations || '',
            // Measurements - handle undefined values properly
            measurements: (() => {
              const measurementsObj = item.measurements || {};
              // Get all measurement values, ensuring no undefined
              const measurementStrings = Object.values(measurementsObj)
                .filter(m => m && (m.value !== undefined && m.value !== null && m.value !== ''))
                .map(m => {
                  const label = m.label || '';
                  const value = (m.value !== undefined && m.value !== null) ? String(m.value) : '';
                  return value ? `${label}: ${value}` : '';
                })
                .filter(s => s !== '');
              return measurementStrings.join(', ') || '';
            })(),
            // Individual measurement fields for direct access (e.g., {{before}}, {{after}})
            // Extract measurement fields by their IDs to avoid undefined
            ...(Object.keys(item.measurements || {}).reduce((acc, key) => {
              const m = item.measurements[key];
              if (m && m.value !== undefined && m.value !== null && m.value !== '') {
                acc[key] = String(m.value);
              } else {
                acc[key] = ''; // Empty string instead of undefined
              }
              return acc;
            }, {}))
          };
        })
      })),
      
      // Individual item placeholders for templates that use direct item references
      // Create flat structure for direct access (e.g., item_1_1_status_pass, item_1_1_status_fail)
      // Note: docxtemplater doesn't support dynamic keys, so we'll use a different approach
      // For individual items, use the sections/items loop structure instead
      
      // Also add top-level status placeholders that can be used in individual item contexts
      // These will be populated per item when using loops
    };

    // Log template variables for debugging
    console.log('Template variables being sent:');
    console.log('- Basic fields:', {
      plant_name: templateVars.plant_name,
      procedure: templateVars.procedure,
      task_code: templateVars.task_code,
      asset_name: templateVars.asset_name,
      location: templateVars.location,
      inspected_by: templateVars.inspected_by
    });
    console.log('- Sections count:', templateVars.sections.length);
    if (templateVars.sections.length > 0) {
      console.log('- First section:', {
        title: templateVars.sections[0].title,
        items_count: templateVars.sections[0].items.length
      });
    }

    // Render document
    try {
      doc.render(templateVars);
      console.log('✓ Document rendered successfully');
    } catch (renderError) {
      console.error('Error rendering document:', renderError);
      // Log docxtemplater specific errors
      if (renderError.properties && renderError.properties.errors) {
        console.error('Template errors:', renderError.properties.errors);
      }
      throw renderError;
    }

    // Generate buffer
    const buf = doc.getZip().generate({
      type: 'nodebuffer',
      compression: 'DEFLATE'
    });

    return buf;
  } catch (error) {
    console.error('Error generating Word document:', error);
    throw error;
  }
}

module.exports = {
  generateWordDocument
};

