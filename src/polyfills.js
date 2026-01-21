import { Buffer } from 'buffer';

// Polyfill Buffer
if (typeof window !== 'undefined') {
    window.Buffer = window.Buffer || Buffer;
    window.process = window.process || { env: {} };
}
