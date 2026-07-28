import type { CapacitorConfig } from '@capacitor/cli'

// Fontainor mobile shell (Capacitor). Wraps the production Vite build in a
// native Android WebView; the same React app runs on web and in the app.
// Wallet connectivity on native goes through the Phantom deeplink protocol
// (src/lib/phantomDeeplink.ts), bounced back via the `fontainor://` scheme
// registered in android/app/src/main/AndroidManifest.xml.
const config: CapacitorConfig = {
  appId: 'com.fontainor.app',
  appName: 'Fontainor',
  webDir: 'dist',
  android: {
    // Keep the WebView on https so window.crypto.subtle + secure-context
    // Solana/Irys code paths behave exactly as on the deployed site.
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
    // Talk to the live registry/API + Solana RPC over https from the app.
    allowNavigation: [
      'fontainor-protocol.vercel.app',
      '*.vercel.app',
      'phantom.app',
      '*.solana.com',
      'solana-rpc.publicnode.com',
    ],
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      backgroundColor: '#0b0b0f',
      showSpinner: false,
      androidSplashResourceName: 'splash',
    },
  },
}

export default config
