module.exports = {
  apps: [
    {
      name: 'elder-monitor',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
        PORT: '3001',
        DEVICE_TOKEN: 'elder-monitor-token',
        ENABLE_MOCK: 'false',
        DEVICE_OFFLINE_TIMEOUT_MS: '8000'
      }
    }
  ]
};
