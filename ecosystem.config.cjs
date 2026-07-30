module.exports = {
  apps: [
    {
      name: 'leadhunter-backend',
      script: './src/server.js',
      cwd: './backend',
      interpreter: 'node',
      watch: false,
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 20,
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      }
    },
    {
      name: 'leadhunter-frontend',
      script: '../node_modules/serve/build/main.js',
      args: '-s dist -l 5173',
      cwd: './frontend',
      interpreter: 'node',
      watch: false,
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 20,
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
