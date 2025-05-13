/**
 * Sagt Alo
 */
interface LambdaResponse {
  statusCode: number;
  body: string;
}

export async function handler(): Promise<LambdaResponse> {
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Ola!' })
  };
}
