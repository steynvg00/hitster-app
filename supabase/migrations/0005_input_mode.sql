-- Add input_mode per answer-option row so session 6 can wire up
-- different input widgets per field per challenge.
-- All existing rows default to 'multiple_choice' (current behaviour).

ALTER TABLE answer_options
  ADD COLUMN IF NOT EXISTS input_mode TEXT NOT NULL DEFAULT 'multiple_choice';

ALTER TABLE answer_options
  ADD CONSTRAINT answer_options_input_mode_check
  CHECK (input_mode IN ('multiple_choice', 'combobox', 'open_text', 'typeable_number', 'slider'));
