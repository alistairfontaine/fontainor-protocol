package com.fontainor.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.solana.mobilewalletadapter.clientlib.protocol.MobileWalletAdapterClient;
import com.solana.mobilewalletadapter.clientlib.scenario.LocalAssociationIntentCreator;
import com.solana.mobilewalletadapter.clientlib.scenario.LocalAssociationScenario;
import com.solana.mobilewalletadapter.clientlib.scenario.Scenario;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Mobile Wallet Adapter (MWA) bridge for the Fontainor Capacitor app.
 *
 * Exposes the Solana Mobile clientlib (com.solanamobile:mobile-wallet-adapter-
 * clientlib) to the WebView so "Connect wallet" can do the native one-tap
 * association flow with ANY installed MWA wallet (Phantom, Solflare, Backpack,
 * ...) instead of being hardwired to Phantom deeplinks.
 *
 * Protocol shape (verified against clientlib 2.0.8 with javap):
 *  - LocalAssociationScenario(timeoutMs) + LocalAssociationIntentCreator
 *    .createAssociationIntent(null, port, session) -> startActivityForResult
 *  - scenario.start().get() -> MobileWalletAdapterClient
 *  - client.authorize(identityUri, iconUri, identityName, cluster) /
 *    client.reauthorize(...) -> AuthorizationResult{authToken, publicKey[]}
 *  - client.signMessagesDetached(msgs[][], addrs[][]) -> SignedMessage.signatures
 *  - client.signAndSendTransactions(txs[][], minContextSlot) -> signatures[][]
 *  - client.deauthorize(authToken)
 *
 * All byte[] payloads cross the JS bridge as base64 (JS side converts to/from
 * base58 where Solana convention requires it).
 */
@CapacitorPlugin(name = "Mwa")
public class MwaPlugin extends Plugin {

    private static final int REQUEST_LOCAL_ASSOCIATION = 4242;
    private static final long ASSOCIATION_START_TIMEOUT_S = 30;
    private static final long RPC_TIMEOUT_S = 120; // user interaction (approve in wallet) happens inside this window

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    private interface WalletOp<T> {
        T run(MobileWalletAdapterClient client) throws Exception;
    }

    @PluginMethod
    public void isWalletAvailable(PluginCall call) {
        boolean available = LocalAssociationIntentCreator.isWalletEndpointAvailable(
                getContext().getPackageManager());
        JSObject ret = new JSObject();
        ret.put("available", available);
        call.resolve(ret);
    }

    @PluginMethod
    public void connect(PluginCall call) {
        final String identityUri = call.getString("identityUri", "https://fontainor-protocol.vercel.app");
        final String iconUri = call.getString("iconUri", "/icon-512.png");
        final String identityName = call.getString("identityName", "Fontainor");
        final String cluster = call.getString("cluster", "mainnet-beta");
        final String authToken = call.getString("authToken"); // null on first connect

        withLocalScenario(call, client -> {
            MobileWalletAdapterClient.AuthorizationResult result;
            if (authToken != null && !authToken.isEmpty()) {
                try {
                    result = (MobileWalletAdapterClient.AuthorizationResult) client
                            .reauthorize(Uri.parse(identityUri), Uri.parse(iconUri), identityName, authToken)
                            .get(RPC_TIMEOUT_S, TimeUnit.SECONDS);
                } catch (Exception reauthFailed) {
                    // stale/revoked token -> fall back to a fresh authorize
                    result = (MobileWalletAdapterClient.AuthorizationResult) client
                            .authorize(Uri.parse(identityUri), Uri.parse(iconUri), identityName, cluster)
                            .get(RPC_TIMEOUT_S, TimeUnit.SECONDS);
                }
            } else {
                result = (MobileWalletAdapterClient.AuthorizationResult) client
                        .authorize(Uri.parse(identityUri), Uri.parse(iconUri), identityName, cluster)
                        .get(RPC_TIMEOUT_S, TimeUnit.SECONDS);
            }
            JSObject ret = new JSObject();
            ret.put("publicKey", Base64.encodeToString(result.publicKey, Base64.NO_WRAP));
            ret.put("authToken", result.authToken);
            ret.put("accountLabel", result.accountLabel != null ? result.accountLabel : "");
            ret.put("walletUriBase", result.walletUriBase != null ? result.walletUriBase.toString() : "");
            return ret;
        });
    }

    @PluginMethod
    public void signMessage(PluginCall call) {
        final String messageB64 = call.getString("message");
        final String addressB64 = call.getString("address");
        final String identityUri = call.getString("identityUri", "https://fontainor-protocol.vercel.app");
        final String iconUri = call.getString("iconUri", "/icon-512.png");
        final String identityName = call.getString("identityName", "Fontainor");
        final String authToken = call.getString("authToken");
        if (messageB64 == null || addressB64 == null || authToken == null) {
            call.reject("signMessage requires message, address and authToken");
            return;
        }

        withLocalScenario(call, client -> {
            // A fresh association needs a (re)authorization before privileged methods.
            client.reauthorize(Uri.parse(identityUri), Uri.parse(iconUri), identityName, authToken)
                    .get(RPC_TIMEOUT_S, TimeUnit.SECONDS);
            byte[] message = Base64.decode(messageB64, Base64.NO_WRAP);
            byte[] address = Base64.decode(addressB64, Base64.NO_WRAP);
            MobileWalletAdapterClient.SignMessagesResult result =
                    (MobileWalletAdapterClient.SignMessagesResult) client
                            .signMessagesDetached(new byte[][]{message}, new byte[][]{address})
                            .get(RPC_TIMEOUT_S, TimeUnit.SECONDS);
            if (result.messages.length == 0 || result.messages[0].signatures.length == 0) {
                throw new IllegalStateException("Wallet returned no signature");
            }
            JSObject ret = new JSObject();
            ret.put("signature", Base64.encodeToString(result.messages[0].signatures[0], Base64.NO_WRAP));
            return ret;
        });
    }

    @PluginMethod
    public void signAndSendTransaction(PluginCall call) {
        final String txB64 = call.getString("transaction");
        final String identityUri = call.getString("identityUri", "https://fontainor-protocol.vercel.app");
        final String iconUri = call.getString("iconUri", "/icon-512.png");
        final String identityName = call.getString("identityName", "Fontainor");
        final String authToken = call.getString("authToken");
        if (txB64 == null || authToken == null) {
            call.reject("signAndSendTransaction requires transaction and authToken");
            return;
        }

        withLocalScenario(call, client -> {
            client.reauthorize(Uri.parse(identityUri), Uri.parse(iconUri), identityName, authToken)
                    .get(RPC_TIMEOUT_S, TimeUnit.SECONDS);
            byte[] tx = Base64.decode(txB64, Base64.NO_WRAP);
            MobileWalletAdapterClient.SignAndSendTransactionsResult result =
                    (MobileWalletAdapterClient.SignAndSendTransactionsResult) client
                            .signAndSendTransactions(new byte[][]{tx}, null)
                            .get(RPC_TIMEOUT_S, TimeUnit.SECONDS);
            if (result.signatures.length == 0) {
                throw new IllegalStateException("Wallet returned no transaction signature");
            }
            JSObject ret = new JSObject();
            ret.put("signature", Base64.encodeToString(result.signatures[0], Base64.NO_WRAP));
            return ret;
        });
    }

    @PluginMethod
    public void deauthorize(PluginCall call) {
        final String authToken = call.getString("authToken");
        if (authToken == null) {
            call.resolve();
            return;
        }
        withLocalScenario(call, client -> {
            client.deauthorize(authToken).get(RPC_TIMEOUT_S, TimeUnit.SECONDS);
            return new JSObject();
        });
    }

    /**
     * Runs one wallet operation inside a fresh local association: launch the
     * association intent, wait for the wallet's WebSocket, run the op, close.
     */
    private <T extends JSObject> void withLocalScenario(PluginCall call, WalletOp<T> op) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No foreground activity");
            return;
        }
        final LocalAssociationScenario scenario =
                new LocalAssociationScenario(Scenario.DEFAULT_CLIENT_TIMEOUT_MS);
        final Intent intent = LocalAssociationIntentCreator.createAssociationIntent(
                null, scenario.getPort(), scenario.getSession());
        try {
            activity.startActivityForResult(intent, REQUEST_LOCAL_ASSOCIATION);
        } catch (ActivityNotFoundException e) {
            call.reject("NO_WALLET", "No MWA-compatible wallet app installed", e);
            return;
        }
        executor.execute(() -> {
            try {
                MobileWalletAdapterClient client =
                        (MobileWalletAdapterClient) scenario.start()
                                .get(ASSOCIATION_START_TIMEOUT_S, TimeUnit.SECONDS);
                T ret = op.run(client);
                call.resolve(ret);
            } catch (Exception e) {
                String msg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                call.reject("WALLET_ERROR", msg, e);
            } finally {
                try {
                    scenario.close().get(3, TimeUnit.SECONDS);
                } catch (Exception ignored) {
                    // association teardown is best-effort
                }
            }
        });
    }
}
