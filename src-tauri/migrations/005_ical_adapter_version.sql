ALTER TABLE source_sync_states
ADD COLUMN adapter_version TEXT NOT NULL DEFAULT 'ical-v1';
