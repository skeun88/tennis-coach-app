import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://luhuiwyhewofjxnbzbdt.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1aHVpd3loZXdvZmp4bmJ6YmR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3MDQyMDYsImV4cCI6MjA5MTI4MDIwNn0.ANDf7QBQS3BwBmsM-U8HXuVDoIFT4P4ndVSahzTKyeo';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
