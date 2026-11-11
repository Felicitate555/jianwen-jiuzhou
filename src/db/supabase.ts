
import { createClient } from '@supabase/supabase-js';

// AI is optional. Missing/invalid public configuration must not prevent booting the game.
function optionalClient() {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  try {
    return createClient(url, key);
  } catch {
    return null;
  }
}

export const supabase = optionalClient();
