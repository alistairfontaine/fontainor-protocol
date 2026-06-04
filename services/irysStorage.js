// services/irysStorage.js

export const uploadToIrys = async (data) => {
    console.warn("⚠️ MOCK MODE ACTIVATED: Skipping real network write");

    // Simulate network latency (1.5 seconds)
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Return the successful "Etch" response
    // This allows the UI to trigger the success toast and pointer update
    return {
        success: true,
        txId: "MOCK_ETCH_SUCCESS_001",
        message: "Mock write successful"
    };
};
