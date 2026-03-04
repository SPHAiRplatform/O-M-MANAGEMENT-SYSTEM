/**
 * Backend validation for checklist responses
 * This ensures pass/fail logic is not in the UI
 */

function validateChecklistResponse(responseData, checklistStructure, validationRules) {
  const errors = [];
  let hasFailures = false;
  let hasPasses = false;

  // Debug: log what we're validating
  console.log('[VALIDATION] responseData type:', typeof responseData);
  console.log('[VALIDATION] responseData keys:', typeof responseData === 'object' ? Object.keys(responseData) : 'N/A');
  console.log('[VALIDATION] validationRules:', JSON.stringify(validationRules));

  if (!checklistStructure || !checklistStructure.sections) {
    return {
      isValid: false,
      errors: ['Invalid checklist structure'],
      overallStatus: 'fail'
    };
  }

  // Validate each section
  checklistStructure.sections.forEach((section) => {
    section.items.forEach((item) => {
      const responseValue = getResponseValue(responseData, item.id);
      console.log(`[VALIDATION] item "${item.id}" type="${item.type}" required=${item.required} hasValidation=${!!item.validation} responseValue=`, JSON.stringify(responseValue));

      // Check required fields
      if (item.required) {
        // For pass_fail types, check if status is set
        if (item.type === 'pass_fail' || item.type === 'pass_fail_with_measurement') {
          if (!responseValue || typeof responseValue !== 'object' || !responseValue.status || responseValue.status === '') {
            errors.push({
              itemId: item.id,
              itemLabel: item.label,
              error: 'Required field: Please select Pass or Fail'
            });
            hasFailures = true;
            return;
          }
          // Check required measurement fields
          if (item.measurement_fields) {
            item.measurement_fields.forEach((field) => {
              if (field.required && (!responseValue[field.id] || responseValue[field.id] === '')) {
                errors.push({
                  itemId: item.id,
                  itemLabel: `${item.label} - ${field.label}`,
                  error: 'Required measurement field is missing'
                });
                hasFailures = true;
              }
            });
          }
        } else if (responseValue === null || responseValue === undefined || responseValue === '') {
          errors.push({
            itemId: item.id,
            itemLabel: item.label,
            error: 'Required field is missing'
          });
          hasFailures = true;
          return;
        }
      }

      // Determine pass/fail for this item
      if (responseValue !== null && responseValue !== undefined) {
        // For pass_fail items, always check the user's selection directly
        // (even if no validation property is defined on the template item)
        if (item.type === 'pass_fail' || item.type === 'pass_fail_with_measurement') {
          if (typeof responseValue === 'object' && responseValue.status === 'fail') {
            hasFailures = true;
            console.log(`[VALIDATION] -> FAIL (pass_fail status='fail')`);
          } else if (typeof responseValue === 'object' && responseValue.status === 'pass') {
            hasPasses = true;
            console.log(`[VALIDATION] -> PASS (pass_fail status='pass')`);
          }
        }
        // For checkbox items: unchecked (false) = fail, checked (true) = pass
        // This is the standard behavior for maintenance checklists
        else if (item.type === 'checkbox') {
          if (item.validation) {
            const itemValidation = validateItem(item, responseValue);
            if (itemValidation === 'fail') {
              hasFailures = true;
              console.log(`[VALIDATION] -> FAIL (checkbox with validation)`);
            } else if (itemValidation === 'pass') {
              hasPasses = true;
              console.log(`[VALIDATION] -> PASS (checkbox with validation)`);
            }
          } else {
            // Default checkbox behavior: checked=pass, unchecked=fail
            if (responseValue === true) {
              hasPasses = true;
              console.log(`[VALIDATION] -> PASS (checkbox checked, no validation)`);
            } else if (responseValue === false) {
              hasFailures = true;
              console.log(`[VALIDATION] -> FAIL (checkbox unchecked, no validation)`);
            }
          }
        }
        // For all other item types with validation rules
        else if (item.validation) {
          const itemValidation = validateItem(item, responseValue);
          if (itemValidation === 'fail') {
            hasFailures = true;
            console.log(`[VALIDATION] -> FAIL (validation rule)`);
          } else if (itemValidation === 'pass') {
            hasPasses = true;
            console.log(`[VALIDATION] -> PASS (validation rule)`);
          }
        }
      }
    });
  });

  // Determine overall status based on validation rules
  let overallStatus = 'pass';
  if (validationRules && validationRules.overall_pass_condition) {
    if (validationRules.overall_pass_condition === 'all_required_pass') {
      overallStatus = hasFailures ? 'fail' : 'pass';
    } else if (validationRules.overall_pass_condition === 'any_pass') {
      overallStatus = hasPasses ? 'pass' : 'fail';
    }
  } else {
    // Default: fail if any failures
    overallStatus = hasFailures ? 'fail' : 'pass';
  }

  console.log(`[VALIDATION] RESULT: hasFailures=${hasFailures} hasPasses=${hasPasses} overallStatus=${overallStatus}`);

  return {
    isValid: errors.length === 0,
    errors,
    overallStatus,
    hasFailures,
    hasPasses
  };
}

function validateItem(item, value) {
  if (!item.validation) return 'pass';

  const validation = item.validation;

  // Pass/Fail validation (for pass_fail and pass_fail_with_measurement types)
  if (item.type === 'pass_fail' || item.type === 'pass_fail_with_measurement') {
    // Value is an object with status, observations, and possibly measurement fields
    if (typeof value === 'object' && value !== null) {
      const status = value.status;
      if (status === 'pass') return 'pass';
      if (status === 'fail') return 'fail';
      // If status is not set, it's invalid
      return 'fail';
    }
    // If value is not an object, it's invalid
    return 'fail';
  }

  // Checkbox validation
  if (item.type === 'checkbox') {
    if (validation.pass === true && value === true) return 'pass';
    if (validation.fail === false && value === false) return 'fail';
    if (validation.pass === false && value === false) return 'pass';
    if (validation.fail === true && value === true) return 'fail';
  }

  // Radio button validation
  if (item.type === 'radio') {
    if (validation.pass && Array.isArray(validation.pass)) {
      if (validation.pass.includes(value)) return 'pass';
    }
    if (validation.fail && Array.isArray(validation.fail)) {
      if (validation.fail.includes(value)) return 'fail';
    }
  }

  // Text input validation (numeric range)
  if (item.type === 'text' && validation.type === 'numeric_range') {
    const numValue = parseFloat(value);
    if (isNaN(numValue)) return 'fail';
    
    if (validation.pass) {
      if (numValue >= validation.pass.min && numValue <= validation.pass.max) {
        return 'pass';
      }
    }
    if (validation.fail) {
      if (numValue >= validation.fail.min && numValue <= validation.fail.max) {
        return 'fail';
      }
    }
  }

  // Date validation
  if (item.type === 'text' && validation.type === 'date') {
    const dateValue = new Date(value);
    if (isNaN(dateValue.getTime())) return 'fail';
    return validation.pass ? 'pass' : 'fail';
  }

  return 'pass'; // Default to pass if no specific validation matches
}

function getResponseValue(responseData, itemId) {
  // Response data structure: { sectionId: { itemId: value } }
  for (const sectionId in responseData) {
    if (responseData[sectionId] && responseData[sectionId][itemId] !== undefined) {
      return responseData[sectionId][itemId];
    }
  }
  return null;
}

module.exports = {
  validateChecklistResponse,
  validateItem,
  getResponseValue
};

