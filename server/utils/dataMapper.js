/**
 * Format-agnostic data mapper
 * Converts database records into a unified data structure
 * that can be used by both Word and Excel generators
 */

function mapTaskDataToTemplate(task, checklistResponse, images = []) {
  // Parse JSONB fields if they're strings
  let checklistStructure = task.checklist_structure;
  if (checklistStructure && typeof checklistStructure === 'string') {
    checklistStructure = JSON.parse(checklistStructure);
  }

  let responseData = {};
  if (checklistResponse && checklistResponse.response_data) {
    responseData = typeof checklistResponse.response_data === 'string' 
      ? JSON.parse(checklistResponse.response_data) 
      : checklistResponse.response_data;
  }

  const metadata = checklistStructure?.metadata || {};

  // Build unified data structure
  const templateData = {
    // Header Information
    plant_name: metadata.plant || 'WITKOP SOLAR PLANT',
    procedure: metadata.procedure || task.template_code || 'PM 013',
    
    // Task Information
    task: {
      code: task.task_code || 'N/A',
      type: task.task_type || 'N/A',
      status: task.status || 'N/A',
      overall_status: task.overall_status || 'N/A',
      scheduled_date: task.scheduled_date ? formatDate(task.scheduled_date) : 'N/A',
      completed_date: task.completed_at ? formatDate(task.completed_at) : 'N/A',
      started_at: task.started_at ? formatDateTime(task.started_at) : 'N/A',
      completed_at: task.completed_at ? formatDateTime(task.completed_at) : 'N/A',
      // Time-only fields for templates (Excel/Word "Start hour" / "Finished hour")
      start_hour: task.started_at ? formatTime(task.started_at) : '',
      finished_hour: task.completed_at ? formatTime(task.completed_at) : '',
      duration_minutes: task.duration_minutes || 0
    },

    // Asset Information
    asset: {
      name: task.asset_name || 'N/A',
      code: task.asset_code || 'N/A',
      type: task.asset_type || 'N/A',
      location: task.location || 'N/A',
      installation_date: task.installation_date ? formatDate(task.installation_date) : 'N/A'
    },

    // Template Information
    template: {
      name: task.template_name || 'N/A',
      code: task.template_code || 'N/A',
      description: task.template_description || 'N/A',
      // "Last revision date" is a template-level value (manual, not per task)
      last_revision_date: metadata.last_revision_date ? formatDate(metadata.last_revision_date) : '',
      checklist_made_by: metadata.checklist_made_by || '',
      last_revision_approved_by: metadata.last_revision_approved_by || ''
    },

    // Checklist Sections with Responses
    sections: [],
    
    // Inspection Metadata
    inspection: {
      maintenance_team: checklistResponse?.maintenance_team || '',
      inspected_by: checklistResponse?.inspected_by || '',
      approved_by: checklistResponse?.approved_by || '',
      submitted_by: checklistResponse?.submitted_by_name || 'N/A',
      submitted_at: checklistResponse?.submitted_at ? formatDateTime(checklistResponse.submitted_at) : 'N/A'
    },

    // Failed Item Images
    images: images.map(img => ({
      filename: img.image_filename || 'N/A',
      path: img.image_path || '',
      comment: img.comment || '',
      uploaded_at: img.uploaded_at ? formatDateTime(img.uploaded_at) : 'N/A',
      item_id: img.item_id || '',
      section_id: img.section_id || ''
    })),

    // Observations (if exists as separate section)
    observations: ''
  };

  // Map checklist sections and items
  if (checklistStructure && checklistStructure.sections) {
    checklistStructure.sections.forEach((section, sectionIndex) => {
      const sectionData = {
        number: sectionIndex + 1,
        title: section.title || '',
        items: []
      };

      if (section.items && Array.isArray(section.items)) {
        section.items.forEach((item, itemIndex) => {
          // Get item value from response data
          const sectionResponse = responseData[section.id];
          const itemValue = sectionResponse ? sectionResponse[item.id] : null;
          
          const itemData = {
            id: item.id || `item_${sectionIndex + 1}_${itemIndex + 1}`, // Add ID for direct access
            number: `${sectionIndex + 1}.${itemIndex + 1}`,
            label: item.label || '',
            type: item.type || 'text',
            status: '',
            measurements: {},
            observations: '',
            has_failed: false
          };

          // Handle different item types
          if (item.type === 'pass_fail' || item.type === 'pass_fail_with_measurement') {
            if (typeof itemValue === 'object' && itemValue && itemValue !== null) {
              itemData.status = itemValue.status || '';
              itemData.has_failed = itemValue.status === 'fail';
              itemData.observations = itemValue.observations || '';

              // Measurement fields - ensure proper handling of undefined/null
              if (item.measurement_fields && Array.isArray(item.measurement_fields)) {
                item.measurement_fields.forEach(field => {
                  const fieldValue = itemValue[field.id];
                  // Always create measurement entry, use empty string if value is missing
                  itemData.measurements[field.id] = {
                    label: field.label || field.id || '',
                    value: (fieldValue !== undefined && fieldValue !== null && fieldValue !== '') 
                      ? String(fieldValue) 
                      : ''
                  };
                });
              }
            } else {
              // Item not answered
              itemData.status = '';
            }
          } else if (item.type === 'checkbox') {
            itemData.status = itemValue ? 'checked' : 'unchecked';
          } else if (item.type === 'text' || item.type === 'textarea') {
            itemData.status = itemValue || '';
          }

          sectionData.items.push(itemData);
        });
      }

      // Check if this is the observations section
      if (section.title && section.title.toUpperCase().includes('OBSERVATION')) {
        const obsItem = section.items?.[0];
        if (obsItem && responseData[section.id]?.[obsItem.id]) {
          templateData.observations = responseData[section.id][obsItem.id];
        }
      }

      templateData.sections.push(sectionData);
    });
  }

  return templateData;
}

function formatDate(date) {
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return 'N/A';
    return d.toLocaleDateString();
  } catch (e) {
    return 'N/A';
  }
}

function formatDateTime(date) {
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return 'N/A';
    return d.toLocaleString();
  } catch (e) {
    return 'N/A';
  }
}

function formatTime(date) {
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return '';
  }
}

module.exports = {
  mapTaskDataToTemplate,
  formatDate,
  formatDateTime,
  formatTime
};

