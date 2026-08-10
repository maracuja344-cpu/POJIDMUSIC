import {
    createClient
} from "https://esm.sh/@supabase/supabase-js@2.112.2?bundle";

import {
    SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_URL
} from "./config.js";


/*
Единственный клиент Supabase для будущих модулей приложения.
Бизнес-логика и запросы к данным должны находиться в других файлах.
*/
export const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);
