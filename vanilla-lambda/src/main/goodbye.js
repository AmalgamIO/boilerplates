/**
 * @typedef {Object} LambdaResponse
 * @property {number} statusCode
 * @property {string} body
 */

/**
 * @returns {Promise<LambdaResponse>}
 */
export async function handler() {
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Ciao!' }),
  };
}
