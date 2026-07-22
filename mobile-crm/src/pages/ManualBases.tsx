import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Lead } from '../types';

export default function ManualBases() {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<any | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [newBaseName, setNewBaseName] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchCampaigns();
  }, []);

  const fetchCampaigns = async () => {
    const { data } = await supabase
      .from('campaigns')
      .select('*')
      .like('name', '(+)%')
      .order('created_at', { ascending: false });
    
    if (data) setCampaigns(data);
  };

  const fetchLeads = async (campaignId: number) => {
    setLoading(true);
    const { data } = await supabase
      .from('leads')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false });
    
    if (data) setLeads(data);
    setLoading(false);
  };

  const handleCreateBase = async () => {
    if (!newBaseName.trim()) return;
    const { data } = await supabase
      .from('campaigns')
      .insert([{ name: newBaseName.trim(), status: 'draft', platform: 'olx' }])
      .select();
    
    if (data && data[0]) {
      setCampaigns([data[0], ...campaigns]);
      setSelectedCampaign(data[0]);
      setNewBaseName('');
      fetchLeads(data[0].id);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 pb-20 pt-4">
      <div className="px-4 pb-4 bg-white shadow-sm border-b">
        <h1 className="text-xl font-bold text-gray-800">Ручные базы</h1>
        <p className="text-xs text-gray-500 mt-1">Просмотр и работа с лидами (AI работает на ПК)</p>
        
        <div className="mt-4 flex gap-2">
          <input
            type="text"
            className="flex-1 bg-gray-100 p-2 rounded-lg text-sm border-none outline-none focus:ring-2 focus:ring-emerald-500"
            placeholder="Имя базы, напр: (+) Новая"
            value={newBaseName}
            onChange={(e) => setNewBaseName(e.target.value)}
          />
          <button 
            className="bg-emerald-500 text-white px-3 py-2 rounded-lg font-medium text-sm shadow-sm"
            onClick={handleCreateBase}
          >
            + Создать
          </button>
        </div>

        <div className="mt-4 overflow-x-auto whitespace-nowrap pb-2 scrollbar-hide flex gap-2">
          {campaigns.map((camp) => (
            <button
              key={camp.id}
              onClick={() => {
                setSelectedCampaign(camp);
                fetchLeads(camp.id);
              }}
              className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
                selectedCampaign?.id === camp.id 
                  ? 'bg-emerald-500 text-white border-emerald-500' 
                  : 'bg-white text-gray-600 border-gray-200'
              }`}
            >
              {camp.name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {!selectedCampaign ? (
          <div className="text-center text-gray-400 mt-10 text-sm">
            Выберите базу сверху
          </div>
        ) : loading ? (
          <div className="text-center text-gray-400 mt-10 text-sm">Загрузка...</div>
        ) : leads.length === 0 ? (
          <div className="text-center text-gray-400 mt-10 text-sm">В этой базе пока нет лидов</div>
        ) : (
          leads.map(lead => (
            <div key={lead.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
              <div className="flex justify-between items-start mb-2">
                <div className="flex-1 overflow-hidden">
                  <h3 className="font-bold text-gray-800 text-base truncate">{lead.name || 'Без имени'}</h3>
                  <p className="text-gray-500 text-xs font-mono mt-1">{lead.phone}</p>
                </div>
                <div className="bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded-md font-medium shrink-0 ml-2">
                  {lead.status === 'new' ? 'Новый' : lead.status === 'ready_to_send' ? 'AI Готов' : lead.status}
                </div>
              </div>

              {lead.title && (
                <div className="mb-3">
                  <a href={lead.source_url || '#'} className="text-blue-500 text-sm hover:underline line-clamp-2">
                    {lead.title}
                  </a>
                </div>
              )}

              {lead.ai_message && (
                <div className="mb-3 bg-blue-50 p-3 rounded-lg border border-blue-100">
                  <p className="text-xs text-gray-800 whitespace-pre-wrap">{lead.ai_message}</p>
                </div>
              )}

              <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-gray-50">
                {lead.phone && (
                  <a 
                    href={`https://wa.me/${lead.wa_phone || lead.phone.replace('+', '')}?text=${encodeURIComponent(lead.ai_message || '')}`}
                    className="flex-1 bg-[#25D366] text-white p-2 rounded-lg flex justify-center items-center font-medium shadow-sm text-sm"
                  >
                    WhatsApp
                  </a>
                )}
                <a 
                  href={`viber://chat?number=${lead.wa_phone || lead.phone.replace('+', '')}`}
                  className="flex-1 bg-[#7360F2] text-white p-2 rounded-lg flex justify-center items-center font-medium shadow-sm text-sm"
                >
                  Viber
                </a>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
