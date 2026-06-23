-- Migration 002: Add was_auto_returned column
-- Tracks tickets that were automatically moved back to queue from expired state

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'ticket_schedule' AND column_name = 'was_auto_returned') THEN
        ALTER TABLE ticket_schedule ADD COLUMN was_auto_returned BOOLEAN DEFAULT FALSE;
    END IF;
END $$;
