/**
 * Cloudflare Email Worker for ValidateCall
 *
 * This worker:
 * 1. Receives inbound emails to your domain
 * 2. Forwards them to Gmail (or any email)
 * 3. POSTs them to ValidateCall API for the Inbox feature
 *
 * Setup:
 * 1. Go to Cloudflare Dashboard → Workers & Pages → Create Worker
 * 2. Paste this code
 * 3. Go to Email → Email Routing → Email Workers
 * 4. Create a route: mariano@voicefleet.ai → this worker
 *
 * Environment Variables (set in Worker Settings):
 * - FORWARD_TO: Email address to forward to (e.g., yomariano05@gmail.com)
 * - VALIDATECALL_API_URL: Your API URL (e.g., https://api.validatecall.com)
 * - INBOUND_API_KEY: Optional API key for security
 */

export default {
    async email(message, env, ctx) {
        console.log(`📧 Received email from ${message.from} to ${message.to}`);

        // Extract email content
        const rawEmail = await new Response(message.raw).text();
        const headers = {};
        message.headers.forEach((value, key) => {
            headers[key] = value;
        });

        // Get the email body (text and HTML)
        let textBody = '';
        let htmlBody = '';

        try {
            // Parse the raw email to extract text/html parts
            // For simplicity, we'll send the raw and let the API parse it
            // In production, you might want to use a library like postal-mime
            const rawSize = message.rawSize;

            // Simple extraction from headers
            const subject = message.headers.get('subject') || '(No subject)';

            // Forward to Gmail first (this is the reliable part)
            const forwardTo = env.FORWARD_TO || 'yomariano05@gmail.com';
            try {
                await message.forward(forwardTo);
                console.log(`✅ Forwarded to ${forwardTo}`);
            } catch (forwardError) {
                console.error(`❌ Forward failed: ${forwardError.message}`);
                // Continue anyway - we still want to store in ValidateCall
            }

            // Now POST to ValidateCall API
            const apiUrl = env.VALIDATECALL_API_URL || 'https://api.validatecall.com';
            const inboundUrl = `${apiUrl}/api/email/inbound`;

            const payload = {
                from: message.from,
                to: message.to,
                subject: subject,
                text: textBody || rawEmail.substring(0, 50000), // Limit size
                html: htmlBody,
                headers: headers,
                rawSize: rawSize,
            };

            try {
                const response = await fetch(inboundUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(env.INBOUND_API_KEY && { 'X-API-Key': env.INBOUND_API_KEY }),
                    },
                    body: JSON.stringify(payload),
                });

                if (response.ok) {
                    const result = await response.json();
                    console.log(`✅ Stored in ValidateCall: ${result.responseId}`);
                } else {
                    const error = await response.text();
                    console.error(`❌ ValidateCall API error: ${response.status} - ${error}`);
                }
            } catch (apiError) {
                console.error(`❌ ValidateCall API call failed: ${apiError.message}`);
                // Don't throw - email was already forwarded
            }

        } catch (error) {
            console.error(`❌ Email processing error: ${error.message}`);
            // Try to forward anyway
            try {
                const forwardTo = env.FORWARD_TO || 'yomariano05@gmail.com';
                await message.forward(forwardTo);
            } catch (e) {
                console.error(`❌ Fallback forward also failed: ${e.message}`);
            }
        }
    }
};
