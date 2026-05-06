-- =====================================================================
-- PRIM chatbot feedback log
-- Run once in Supabase SQL Editor.
-- =====================================================================
-- One row per thumbs-up or thumbs-down on an assistant message. Used
-- to find weak spots in the system prompt and tune over time.
-- =====================================================================

CREATE TABLE IF NOT EXISTS chat_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  rating SMALLINT NOT NULL,           -- +1 (thumbs up) | -1 (thumbs down)
  message_text TEXT,                   -- the assistant message that was rated
  preceding_user_message TEXT,         -- the user message that triggered it
  current_view TEXT,                   -- which tab the user was on
  notes TEXT,                          -- optional free-text feedback
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_feedback_user_idx ON chat_feedback (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS chat_feedback_rating_idx ON chat_feedback (rating, created_at DESC);

-- RLS — users can write their own feedback, admins can read all
ALTER TABLE chat_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_feedback_self_insert" ON chat_feedback;
CREATE POLICY "chat_feedback_self_insert" ON chat_feedback FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "chat_feedback_admin_read" ON chat_feedback;
CREATE POLICY "chat_feedback_admin_read" ON chat_feedback FOR SELECT
  USING (public.is_admin(auth.uid()));
