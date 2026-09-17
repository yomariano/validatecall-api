const errorSchema = {
    type: 'object',
    properties: { error: { type:'object', properties:{ code:{type:'string'}, message:{type:'string'} }, required:['code','message'] } },
};
const security = [{ bearerAuth: [] }];
const json = content => ({ description:'JSON response.', content: { 'application/json': { schema: content } } });

export const openApiDocument = {
    openapi: '3.1.0',
    info: {
        title: 'ValidateCall API',
        version: '1.0.0',
        description: 'Create leads, campaigns and GPT Live assistants, place calls, and retrieve outcomes, transcripts and recordings. API keys are created in the ValidateCall Developer portal.',
    },
    servers: [{ url: process.env.PUBLIC_API_URL || 'https://api.validatecall.com/v1' }],
    components: {
        securitySchemes: { bearerAuth: { type:'http', scheme:'bearer', bearerFormat:'ValidateCall API key' } },
        schemas: {
            Error: errorSchema,
            ResearchInput: { type:'object', required:['keyword','location'], properties:{ keyword:{type:'string',maxLength:150}, location:{type:'string',maxLength:150}, maxResults:{type:'integer',minimum:1,maximum:20,default:10}, startingUrls:{type:'array',maxItems:3,items:{type:'string',format:'uri'}} } },
            LeadInput: { type:'object', required:['name'], properties:{ name:{type:'string'}, phone:{type:['string','null']}, email:{type:['string','null']}, address:{type:['string','null']}, city:{type:['string','null']}, website:{type:['string','null']}, category:{type:['string','null']}, status:{type:'string'}, notes:{type:['string','null']}, tags:{type:'array',items:{type:'string'}}, place_id:{type:['string','null']} } },
            CampaignInput: { type:'object', required:['name','product_idea'], properties:{ name:{type:'string'}, product_idea:{type:'string'}, company_context:{type:['string','null']}, lead_ids:{type:'array',items:{type:'string',format:'uuid'}}, selected_agent_id:{type:['string','null']}, status:{type:'string'}, sender_name:{type:['string','null']}, sender_email:{type:['string','null']} } },
            AssistantInput: { type:'object', required:['name','model','voice'], properties:{ name:{type:'string'}, instructions:{type:'string'}, first_message:{type:'string'}, realtime_provider:{type:'string',example:'openai'}, model:{type:'string',example:'gpt-live-1'}, voice:{type:'string',example:'willow'}, language:{type:'string',example:'en'}, voicemail_action:{type:'string',enum:['hang_up','leave_message']}, voicemail_message:{type:'string'}, end_call_enabled:{type:'boolean'}, live_settings:{type:'object'} } },
            CallInput: { type:'object', properties:{ phone_number:{type:'string',example:'+35319696333'}, lead_id:{type:'string',format:'uuid'}, campaign_id:{type:'string',format:'uuid'}, assistant_id:{type:'string'}, from_number_id:{type:'string',format:'uuid'}, customer_name:{type:'string'}, product_idea:{type:'string'}, company_context:{type:'string'} }, description:'Supply phone_number and assistant_id directly, or use lead_id and campaign_id to inherit them.' },
        },
    },
    paths: {
        '/health': { get:{ summary:'Check API availability', responses:{200:json({type:'object'})} } },
        '/account': { get:{ summary:'Get the authenticated account', security, responses:{200:json({type:'object'}),401:json(errorSchema)} } },
        '/research/leads': { post:{ summary:'Research sourced business leads', description:'Reads public business pages and returns only contact details grounded in the supplied source evidence. Results are not saved automatically.', security, requestBody:{required:true,...json({$ref:'#/components/schemas/ResearchInput'})}, responses:{200:json({type:'object'}),400:json(errorSchema),429:json(errorSchema)} } },
        '/leads': {
            get:{ summary:'List leads', security, responses:{200:json({type:'object'}),401:json(errorSchema),403:json(errorSchema)} },
            post:{ summary:'Create one or more leads', security, requestBody:{required:true,...json({oneOf:[{$ref:'#/components/schemas/LeadInput'},{type:'object',properties:{leads:{type:'array',items:{$ref:'#/components/schemas/LeadInput'}}}}]})}, responses:{201:json({type:'object'}),400:json(errorSchema),403:json(errorSchema)} },
        },
        '/leads/{id}': {
            get:{ summary:'Get a lead', security, parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}], responses:{200:json({type:'object'}),404:json(errorSchema)} },
            patch:{ summary:'Update a lead', security, parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}], requestBody:{required:true,...json({$ref:'#/components/schemas/LeadInput'})}, responses:{200:json({type:'object'}),404:json(errorSchema)} },
            delete:{ summary:'Delete a lead', security, parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}], responses:{200:json({type:'object'}),404:json(errorSchema)} },
        },
        '/campaigns': {
            get:{ summary:'List campaigns', security, responses:{200:json({type:'object'})} },
            post:{ summary:'Create a campaign', security, requestBody:{required:true,...json({$ref:'#/components/schemas/CampaignInput'})}, responses:{201:json({type:'object'})} },
        },
        '/campaigns/{id}': {
            get:{ summary:'Get a campaign', security, parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}], responses:{200:json({type:'object'}),404:json(errorSchema)} },
            patch:{ summary:'Update a campaign', security, parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}], requestBody:{required:true,...json({type:'object'})}, responses:{200:json({type:'object'}),404:json(errorSchema)} },
            delete:{ summary:'Delete a campaign', security, parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}], responses:{200:json({type:'object'}),404:json(errorSchema)} },
        },
        '/campaigns/{id}/recalculate': { post:{ summary:'Recalculate campaign and lead call counters', security, parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}], responses:{200:json({type:'object'}),404:json(errorSchema)} } },
        '/assistants': {
            get:{ summary:'List voice assistants', security, responses:{200:json({type:'object'})} },
            post:{ summary:'Create a voice assistant', security, requestBody:{required:true,...json({$ref:'#/components/schemas/AssistantInput'})}, responses:{201:json({type:'object'})} },
        },
        '/assistants/{id}': {
            get:{ summary:'Get a voice assistant', security, parameters:[{name:'id',in:'path',required:true,schema:{type:'string'}}], responses:{200:json({type:'object'}),404:json(errorSchema)} },
            patch:{ summary:'Update a voice assistant', security, parameters:[{name:'id',in:'path',required:true,schema:{type:'string'}}], requestBody:{required:true,...json({$ref:'#/components/schemas/AssistantInput'})}, responses:{200:json({type:'object'}),404:json(errorSchema)} },
            delete:{ summary:'Delete a voice assistant', security, parameters:[{name:'id',in:'path',required:true,schema:{type:'string'}}], responses:{200:json({type:'object'}),404:json(errorSchema)} },
        },
        '/phone-numbers': { get:{ summary:'List available caller numbers', security, parameters:[{name:'destination',in:'query',schema:{type:'string'}}], responses:{200:json({type:'object'})} } },
        '/phone-numbers/readiness': { post:{ summary:'Check caller-number readiness for destinations', security, requestBody:{required:true,...json({type:'object',properties:{phone_numbers:{type:'array',items:{type:'string'}}}})}, responses:{200:json({type:'object'})} } },
        '/calls': {
            get:{ summary:'List calls and outcomes', security, responses:{200:json({type:'object'})} },
            post:{ summary:'Place one call', description:'Requires an Idempotency-Key header. Reusing the key returns the original result and never dials twice.', security, parameters:[{name:'Idempotency-Key',in:'header',required:true,schema:{type:'string',minLength:8}}], requestBody:{required:true,...json({$ref:'#/components/schemas/CallInput'})}, responses:{201:json({type:'object'}),409:json(errorSchema)} },
        },
        '/calls/{id}': { get:{ summary:'Get a call, transcript, summary and action items', security, parameters:[{name:'id',in:'path',required:true,schema:{type:'string'}}], responses:{200:json({type:'object'}),404:json(errorSchema)} } },
        '/calls/{id}/recording': { get:{ summary:'Download a call recording', security, parameters:[{name:'id',in:'path',required:true,schema:{type:'string'}}], responses:{200:{description:'WAV audio',content:{'audio/wav':{schema:{type:'string',contentEncoding:'binary'}}}},404:json(errorSchema)} } },
    },
};
