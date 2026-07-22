function extractOlxUserId() {
    const links = document.querySelectorAll('a[href*="/list/user/"]');
    for (let a of links) {
        const match = a.href.match(/\/list\/user\/([a-zA-Z0-9]+)/);
        if (match && match[1]) {
            return match[1];
        }
    }
    return null;
}

async function checkDuplicate() {
    const userId = extractOlxUserId();
    const url = window.location.origin + window.location.pathname; // Clean URL

    if (!userId && !url) return;

    try {
        const res = await fetch(`http://localhost:3001/api/parser/check-lead?url=${encodeURIComponent(url)}&userId=${encodeURIComponent(userId || '')}`);
        if (res.ok) {
            const data = await res.json();
            if (data.duplicateType) {
                const banner = document.createElement('div');
                banner.id = 'leadhunter-banner';
                banner.style.position = 'fixed';
                banner.style.top = '120px'; // Ниже меню OLX
                banner.style.left = '20px'; // Слева
                banner.style.padding = '16px 20px';
                banner.style.borderRadius = '12px'; // Островок
                banner.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.3)'; // Тень
                banner.style.textAlign = 'center';
                banner.style.fontWeight = '600';
                banner.style.color = '#fff';
                banner.style.zIndex = '999999';
                banner.style.fontFamily = 'system-ui, -apple-system, sans-serif';
                banner.style.maxWidth = '280px';
                banner.style.backdropFilter = 'blur(10px)';
                
                if (data.duplicateType === 'url') {
                    banner.style.backgroundColor = '#EF4444'; // Red
                    banner.innerText = '⚠️ ЭТО ОБЪЯВЛЕНИЕ УЖЕ В БАЗЕ';
                } else {
                    banner.style.backgroundColor = '#F59E0B'; // Orange
                    banner.innerText = '⚠️ ЭТОТ АВТОР УЖЕ ЕСТЬ В БАЗЕ (другое объявление)';
                }
                document.body.appendChild(banner);

                const buttons = document.querySelectorAll('button');
                buttons.forEach(btn => {
                    if (btn.innerText.toLowerCase().includes('показати') || btn.innerText.toLowerCase().includes('показать')) {
                        btn.style.opacity = '0.3';
                        btn.style.pointerEvents = 'none';
                    }
                });
            } else {
                const banner = document.createElement('div');
                banner.id = 'leadhunter-banner';
                banner.style.position = 'fixed';
                banner.style.top = '120px'; 
                banner.style.left = '20px'; 
                banner.style.padding = '16px 20px';
                banner.style.borderRadius = '12px'; 
                banner.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.3)'; 
                banner.style.textAlign = 'center';
                banner.style.fontWeight = '600';
                banner.style.color = '#fff';
                banner.style.zIndex = '999999';
                banner.style.fontFamily = 'system-ui, -apple-system, sans-serif';
                banner.style.maxWidth = '280px';
                banner.style.backdropFilter = 'blur(10px)';
                
                // Зеленый цвет для новых
                banner.style.backgroundColor = 'rgba(16, 185, 129, 0.95)';
                banner.innerText = '✅ Лид чист (Можно брать)';
                banner.style.transition = 'opacity 0.5s ease-in-out';
                
                document.body.appendChild(banner);

                // Уводим в полупрозрачность через 2.5 секунды, не удаляя полностью
                setTimeout(() => {
                    if (document.body.contains(banner)) {
                        banner.style.opacity = '0.5';
                    }
                }, 2500);
            }
        }
    } catch (e) {
        console.error('LeadHunter Check Error:', e);
    }
}

// Run check on load
window.addEventListener('load', () => {
    setTimeout(checkDuplicate, 1000); // Small delay on load for DOM
});

// SPA URL change tracker
let lastUrl = location.href;
setInterval(() => {
    if (location.href !== lastUrl) {
        lastUrl = location.href;
        
        // Remove old banner if exists
        const oldBanner = document.getElementById('leadhunter-banner');
        if (oldBanner) oldBanner.remove();

        // Restore button opacity
        const buttons = document.querySelectorAll('button');
        buttons.forEach(btn => {
            if (btn.innerText.toLowerCase().includes('показати') || btn.innerText.toLowerCase().includes('показать')) {
                btn.style.opacity = '1';
                btn.style.pointerEvents = 'auto';
            }
        });

        // Check new page after DOM updates
        setTimeout(checkDuplicate, 1500);
    }
}, 500);

document.addEventListener('keydown', async (event) => {
    // Check for Cmd+1 (Mac) or Ctrl+1 (Win/Linux)
    if ((event.metaKey || event.ctrlKey) && event.key === '1') {
        event.preventDefault(); // Prevent default browser behavior

        let selection = window.getSelection().toString().trim();
        selection = selection.replace(/[^\d+]/g, ''); // leave only digits and '+'
        
        if (selection.length < 10) {
            alert('LeadHunter: Выделен некорректный номер телефона (менее 10 символов)!');
            return;
        }

        // Extract details
        let title = document.title;
        const h1 = document.querySelector('h1');
        if (h1) title = h1.innerText.trim();

        let name = 'Неизвестно';
        const sellerCardH4 = document.querySelector('[data-cy="seller_card"] h4');
        const userProfileH4 = document.querySelector('[data-testid="user-profile"] h4');
        const anyH4 = document.querySelector('h4');
        const nameEl = document.querySelector('[data-cy="seller-name"]');
        
        if (sellerCardH4) name = sellerCardH4.innerText.trim();
        else if (userProfileH4) name = userProfileH4.innerText.trim();
        else if (anyH4) name = anyH4.innerText.trim();
        else if (nameEl) name = nameEl.innerText.trim();

        let adText = '';
        const descEl = document.querySelector('div.er34gjm0'); // Common OLX desc wrapper
        if (descEl) {
            adText = descEl.innerText.trim();
        } else {
            const fallbackDesc = document.querySelector('[data-cy="ad_description"]');
            if (fallbackDesc) adText = fallbackDesc.innerText.trim();
        }

        chrome.storage.local.get(['activeBase'], async (result) => {
            const campaignId = result.activeBase || null;

            const leadData = {
                campaign_id: campaignId,
                phone: selection,
                title: title,
                url: window.location.href.split('?')[0],
                olxUserId: extractOlxUserId(),
                name: name,
                ad_text: adText
            };

            try {
                const response = await fetch('http://localhost:3001/api/parser/manual-leads', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(leadData)
                });

                if (response.ok) {
                    const result = await response.json();
                    if (result.appended) {
                        showToast('🔄 Данные дополнены к существующему лиду');
                    } else {
                        showToast('✅ Новый лид сохранен!');
                    }
                    // Update banner to show this page is now in the database
                    const oldBanner = document.getElementById('leadhunter-banner');
                    if (oldBanner) oldBanner.remove();
                    const banner = document.createElement('div');
                    banner.id = 'leadhunter-banner';
                    Object.assign(banner.style, {
                        position: 'fixed', top: '120px', left: '20px',
                        padding: '16px 20px', borderRadius: '12px',
                        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)',
                        textAlign: 'center', fontWeight: '600', color: '#fff',
                        zIndex: '999999', fontFamily: 'system-ui, -apple-system, sans-serif',
                        maxWidth: '280px', backdropFilter: 'blur(10px)',
                        backgroundColor: '#EF4444'
                    });
                    banner.innerText = '⚠️ ЭТО ОБЪЯВЛЕНИЕ УЖЕ В БАЗЕ';
                    document.body.appendChild(banner);
                } else {
                    const err = await response.json();
                    showToast(`❌ Ошибка бэкенда: ${err.error || response.statusText}`, true);
                }
            } catch (error) {
                console.error('LeadHunter Error:', error);
                showToast('❌ Ошибка сети! Бэкенд запущен?', true);
            }
        });
    }
});

function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.innerText = message;
    Object.assign(toast.style, {
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        backgroundColor: isError ? '#EF4444' : '#10B981',
        color: '#FFFFFF',
        padding: '12px 24px',
        borderRadius: '8px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '16px',
        fontWeight: '500',
        zIndex: '999999',
        transition: 'opacity 0.3s ease-in-out',
        opacity: '0'
    });

    document.body.appendChild(toast);

    // Trigger reflow for animation
    void toast.offsetWidth;
    toast.style.opacity = '1';

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => {
            document.body.removeChild(toast);
        }, 300);
    }, 2000);
}
