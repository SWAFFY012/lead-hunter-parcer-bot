module.exports = {
  apps: [
    {
      name: 'leadhunter-backend',
      script: './src/server.js',
      cwd: './backend',
      interpreter: 'node',
      watch: false,
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
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
