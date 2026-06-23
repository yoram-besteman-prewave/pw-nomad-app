-- Migration 003: Add scheduled_lines column for mismatch detection
-- This column stores the line count at the time of scheduling,
-- so we can detect if someone changed it in Jira afterwards.

-- Add scheduled_lines column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'ticket_schedule' AND column_name = 'scheduled_lines') THEN
        ALTER TABLE ticket_schedule ADD COLUMN scheduled_lines INTEGER;
        RAISE NOTICE 'Added scheduled_lines column to ticket_schedule';
    ELSE
        RAISE NOTICE 'scheduled_lines column already exists';
    END IF;
END $$;


