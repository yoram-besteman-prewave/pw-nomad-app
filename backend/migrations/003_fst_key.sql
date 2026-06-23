-- Migration 003: Add fst_key column for jumped tickets
-- Stores the FST ticket key created when a PRES ticket is jumped

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'ticket_schedule' AND column_name = 'fst_key') THEN
        ALTER TABLE ticket_schedule ADD COLUMN fst_key VARCHAR(20);
    END IF;
END $$;
