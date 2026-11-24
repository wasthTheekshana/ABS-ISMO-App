import app from './app.js';
import { startDailyArchive } from './jobs/dailyArchive.js';

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  AB SECURITAS ISOMS REST API SERVER RUNNING`);
  console.log(`  Listening on Port: http://localhost:${PORT}`);
  console.log(`  Health Check:     http://localhost:${PORT}/api/health`);
  console.log(`=======================================================`);
  // SRS FR-18: store yesterday's organisation-wide daily reports (and re-check hourly).
  startDailyArchive();
});
