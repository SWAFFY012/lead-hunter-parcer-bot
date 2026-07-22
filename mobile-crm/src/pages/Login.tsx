import { useState } from 'react';

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin === import.meta.env.VITE_APP_PASSWORD) {
      localStorage.setItem('auth', 'true');
      onLogin();
    } else {
      setError(true);
      setPin('');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-md p-8">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-gray-900">LeadHunter CRM</h2>
          <p className="text-gray-500 mt-2">Введите пароль для доступа</p>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <input
              type="password"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value);
                setError(false);
              }}
              placeholder="Пароль"
              className={`w-full px-4 py-3 rounded-lg border ${
                error ? 'border-red-500 bg-red-50' : 'border-gray-300'
              } focus:ring-2 focus:ring-blue-500 outline-none transition-colors`}
              autoFocus
            />
            {error && <p className="text-red-500 text-sm mt-2">Неверный пароль</p>}
          </div>
          
          <button
            type="submit"
            className="w-full bg-blue-600 text-white font-medium py-3 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Войти
          </button>
        </form>
      </div>
    </div>
  );
}
