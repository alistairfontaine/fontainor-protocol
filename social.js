/**
 * Fontainor Social Engine - v0.2
 * Logic for processing public support/tips
 */

function processTip(registry, senderWallet, amountInUsdc) {
    // 1. Validation
    if (amountInUsdc <= 0) throw new Error("Tip must be greater than zero.");

    // 2. Create the support event
    const supportEvent = {
        sender: senderWallet,
        amount: amountInUsdc,
        timestamp: new Date().toISOString()
    };

    // 3. Update the registry object
    registry.social_layer.support_ledger.push(supportEvent);
    registry.social_layer.total_tips_received += amountInUsdc;

    console.log(`Tip of ${amountInUsdc} USDC from ${senderWallet} recorded.`);
    return registry;
}

module.exports = { processTip };
