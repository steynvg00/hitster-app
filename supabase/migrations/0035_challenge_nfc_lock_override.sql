-- nullable tri-state: NULL = inherit from set's nfc_lock_enabled,
-- true = always require NFC unlock, false = never require
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS nfc_lock_override boolean;
