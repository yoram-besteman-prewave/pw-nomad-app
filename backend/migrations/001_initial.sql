-- NoMAD Database Schema v1
-- Initial migration - creates all tables for state persistence

-- Ticket scheduling state
-- Stores the queue position, lock status for each ticket
CREATE TABLE IF NOT EXISTS ticket_schedule (
    ticket_key VARCHAR(20) PRIMARY KEY,
    priority_order INTEGER,
    in_queue BOOLEAN DEFAULT FALSE,
    locked_week INTEGER,
    locked_year INTEGER,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for quick queue lookups
CREATE INDEX IF NOT EXISTS idx_ticket_schedule_queue 
ON ticket_schedule(in_queue, priority_order) 
WHERE in_queue = TRUE;

-- Index for locked tickets by week
CREATE INDEX IF NOT EXISTS idx_ticket_schedule_locked 
ON ticket_schedule(locked_year, locked_week) 
WHERE locked_week IS NOT NULL;

-- Week-specific settings
-- Stores per-week capacity overrides and reservation unlocks
CREATE TABLE IF NOT EXISTS week_settings (
    year INTEGER NOT NULL,
    week INTEGER NOT NULL,
    capacity INTEGER,
    small_unlocked BOOLEAN DEFAULT FALSE,
    medium_unlocked BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (year, week)
);

-- Global settings
-- Stores app-wide configuration as JSON (flexible for future needs)
CREATE TABLE IF NOT EXISTS global_settings (
    key VARCHAR(50) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default global settings if not exist
INSERT INTO global_settings (key, value) 
VALUES 
    ('weekly_capacity', '4000'),
    ('reservation_defaults', '{"small": 500, "medium": 1500}')
ON CONFLICT (key) DO NOTHING;

-- Add scheduled_lines column for mismatch detection (if not exists)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'ticket_schedule' AND column_name = 'scheduled_lines') THEN
        ALTER TABLE ticket_schedule ADD COLUMN scheduled_lines INTEGER;
    END IF;
END $$;

