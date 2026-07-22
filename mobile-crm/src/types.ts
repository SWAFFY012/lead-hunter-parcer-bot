export interface Lead {
  id: number;
  phone: string;
  name: string | null;
  title: string | null;
  ad_text: string | null;
  source_url: string | null;
  olxUserId: string | null;
  wa_phone: string | null;
  city: string | null;
  campaign_id: number | null;
  platform: string | null;
  ig_username: string | null;
  status: string;
  tags: string[];
  notes: string | null;
  assigned_account: string | null;
  ai_message: string | null;
  created_at: string;
  last_contact_at: string | null;
  followup_count: number;
  reaction_timestamp: string | null;
}
