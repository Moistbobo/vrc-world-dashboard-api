module.exports = {
  apps: [
    {
      name: 'world-tagger-api-test',
      script: 'dist/main.js',
      cwd: '/home/world-tagger/test/sos-world-tagger-api',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'test'
      },
      log_file: '/home/world-tagger/.pm2/logs/world-tagger-api-test.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      time: true
    }
  ]
};
