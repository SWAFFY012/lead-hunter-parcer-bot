document.addEventListener('DOMContentLoaded', async () => {
    const select = document.getElementById('bases-select');
    const input = document.getElementById('new-base-input');
    const saveBtn = document.getElementById('save-btn');
    const status = document.getElementById('status');

    function setStatus(msg, isError = false) {
        status.textContent = msg;
        status.className = isError ? 'error' : '';
        setTimeout(() => { status.textContent = ''; }, 3000);
    }

    // Load existing manual bases from backend
    try {
        const response = await fetch('http://localhost:3001/api/campaigns');
        if (response.ok) {
            const campaigns = await response.json();
            // Filter manual campaigns
            const manualBases = campaigns.filter(c => c.name.startsWith('(+)'));
            
            manualBases.forEach(base => {
                const option = document.createElement('option');
                option.value = base.id;
                option.textContent = base.name;
                select.appendChild(option);
            });
        }
    } catch (err) {
        setStatus('Ошибка связи с бэкендом (он запущен?)', true);
    }

    // Pre-select active base if set
    chrome.storage.local.get(['activeBase'], (result) => {
        if (result.activeBase) {
            // Check if it exists in the select
            let exists = false;
            for (let i = 0; i < select.options.length; i++) {
                if (select.options[i].value == result.activeBase) {
                    exists = true;
                    select.selectedIndex = i;
                    break;
                }
            }
        }
    });

    saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        let selectedId = select.value;
        const newName = input.value.trim();

        if (newName) {
            // Create new campaign on backend
            try {
                const response = await fetch('http://localhost:3001/api/campaigns', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: newName, is_manual: true })
                });

                if (response.ok) {
                    const campaign = await response.json();
                    selectedId = campaign.id;
                    // Add to select and choose it
                    const option = document.createElement('option');
                    option.value = campaign.id;
                    option.textContent = campaign.name;
                    select.appendChild(option);
                    select.value = campaign.id;
                    input.value = '';
                } else {
                    setStatus('Ошибка создания базы', true);
                    saveBtn.disabled = false;
                    return;
                }
            } catch (err) {
                setStatus('Сетевая ошибка', true);
                saveBtn.disabled = false;
                return;
            }
        }

        if (!selectedId) {
            setStatus('Выберите или создайте базу!', true);
            saveBtn.disabled = false;
            return;
        }

        // Save to storage
        chrome.storage.local.set({ activeBase: selectedId }, () => {
            setStatus('✅ Активная база установлена!');
            saveBtn.disabled = false;
        });
    });
});
