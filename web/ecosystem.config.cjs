// PM2 进程配置：用于在服务器上守护运行 elder-monitor-dashboard 服务。
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
        ENABLE_MOCK: 'false',
        DEVICE_OFFLINE_TIMEOUT_MS: '8000'
      }
    }
  ]
};
