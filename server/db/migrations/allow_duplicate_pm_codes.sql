-- Migration: Allow multiple templates with same PM code (differentiated by template name)
-- This allows templates like "Annual Inspection of CCTV" and "Monthly Inspection of CCTV"
-- to share the same PM number but be differentiated by their template names

-- Step 1: Drop the unique constraint on template_code
ALTER TABLE checklist_templates DROP CONSTRAINT IF EXISTS checklist_templates_template_code_key;

-- Step 2: Add a composite unique constraint on (template_code, template_name)
-- Wrapped in DO block to prevent error if constraint already exists
DO 
$$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checklist_templates_code_name_unique'
  ) THEN
    ALTER TABLE checklist_templates
    ADD CONSTRAINT checklist_templates_code_name_unique
    UNIQUE (template_code, template_name);
  END IF;
END
$$
;

-- Step 3: Add an index on template_code for faster lookups (since it's no longer unique)
CREATE INDEX IF NOT EXISTS idx_checklist_templates_template_code
ON checklist_templates(template_code);

COMMENT ON CONSTRAINT checklist_templates_code_name_unique ON checklist_templates IS
'Ensures template_code + template_name combination is unique, allowing same PM number for different template names (e.g., Annual vs Monthly CCTV inspections)';
