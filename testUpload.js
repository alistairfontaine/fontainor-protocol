const { uploadData } = require('./irysStorage');

(async () => {
    try {
        console.log("Starting test upload...");
        await uploadData("Fontainor Protocol: Final Node.js Test");
        console.log("Test execution finished.");
    } catch (error) {
        // This will now show the actual technical error instead of just "Test failed"
        console.error("--- FULL ERROR REPORT ---");
        console.error(error);
    }
})();
