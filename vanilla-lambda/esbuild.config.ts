import { build } from 'esbuild';
import alias from 'esbuild-plugin-alias';

build({
  entryPoints: ['src/main/hello.ts', 'src/main/goodbye.js'],
  outdir: 'dist',
  bundle: true,
  minify: true,
  platform: 'node',
  treeShaking: true,
  target: 'node20',
  format: 'esm',
  plugins: [
    alias({
      '@app': './src/main'
    })
  ],
  sourcemap: "external",
  external: [
    // 'aws-sdk', // AWS SDK is already available in the AWS Lambda environment
    // '@aws-sdk/client-s3',
    // '@aws-sdk/credential-providers',
    // '@aws-sdk/client-textract',
    // '@aws-sdk/s3-request-presigner'
  ],
}).catch(() => process.exit(1));