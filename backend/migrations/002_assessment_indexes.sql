CREATE INDEX IF NOT EXISTS idx_assessments_user_created
    ON assessments (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_assessments_user_status_created
    ON assessments (user_id, status, created_at DESC);
