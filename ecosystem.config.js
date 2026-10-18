module.exports = {
  apps: [
    {
      name: 'world-tagger-api',
      script: 'dist/main.js',
      cwd: '/home/world-tagger/release/sos-world-tagger-api',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production'
      },
      log_file: '/home/world-tagger/.pm2/logs/world-tagger-api.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      time: true
    }
  ]
};
