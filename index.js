import 'dotenv/config';
import app from './app.js';
// Import services
import callScheduler from './services/callScheduler.js';
import triggerEngine from './services/triggerEngine.js';
import emailSequenceScheduler from './services/emailSequenceScheduler.js';
import workflowScheduler from './services/workflowScheduler.js';

const PORT = process.env.PORT || 3002;

app.listen(PORT, () => {
    console.log(`🚀 API Server running on http://localhost:${PORT}`);
    console.log(`📡 Health check: http://localhost:${PORT}/health`);

    if (process.env.RUN_SCHEDULERS !== 'true') return;

    // Start the call scheduler
    callScheduler.start();

    // Start the trigger engine (automated marketing emails)
    triggerEngine.start();

    // Start the email sequence scheduler (cold email automation)
    emailSequenceScheduler.start();

    // Start the multi-channel workflow scheduler (email + calls + SMS)
    workflowScheduler.start();
});
