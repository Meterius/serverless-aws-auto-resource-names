const { kebabCase } = require("change-case");
const fs = require("fs");
const path = require("path");

function identity(val) { return val; }

// defines type identifier
class TypeID {
    constructor(root, provider, name){
        this.root = root;
        this.provider = provider;
        this.name = name;
    }

    /**
     * checks whether identifiers are equal
     * @param {TypeID} a
     * @param {TypeID} b
     * @returns {boolean}
     */
    static equal(a, b){
        return a.root === b.root && a.provider === b.provider && a.name === b.name;
    }
}

// defines behaviour when inserting the resource name for resources of a specific type provider and type name
class TypeSpec {
    /**
     * @param {TypeID} typeId
     * @param {Object?} options
     * @param {Function?} options.nameConverter - converts final name before usage
     * @param {Function?} options.logicalNameConverter - converts the logical name into the suffix used
     * @param {Boolean?} options.namePropIncludesTypeName - whether the type uses the type name when deciding the type name property
     * @param {Boolean?} options.noNameInsertion - whether auto generated name should be generated on this type
     * @param {String?} options.namePropReplacement - used instead of name prop generation if specified
     */
    constructor(typeId, options = {}){
        const {
            nameConverter = identity,
            logicalNameConverter = kebabCase,
            namePropIncludesTypeName = true,
            noNameInsertion = false,
            namePropReplacement = undefined,
        } = options;

        this.typeId = typeId;
        this.nameConverter = nameConverter;
        this.logicalNameConverter = logicalNameConverter;
        this.namePropIncludesTypeName = namePropIncludesTypeName;
        this.noNameInsertion = noNameInsertion;
        this.namePropReplacement = namePropReplacement;
    }

    /**
     * generates property name where the generated name value is inserted
     * @returns {string}
     */
    getNameProp(){
        return this.namePropReplacement || (this.namePropIncludesTypeName ? this.typeId.name + "Name" : "Name");
    }

    /**
     * generates resource name based on the given prefix and logical name
     * @param prefix
     * @param logicalName
     * @returns {*}
     */
    getNameValue(prefix, logicalName){
        return this.nameConverter(prefix + this.logicalNameConverter(logicalName));
    }

    /**
     * checks if this specification applies for typeId
     * @param {TypeID} typeId
     * @returns {boolean}
     */
    isApplicable(typeId){
        return TypeID.equal(this.typeId, typeId);
    }

    /**
     * checks whether name insertion should be performed for this type
     */
    isNameInserted(){
        return !this.noNameInsertion;
    }
}

// list of custom type behaviour specifications
const typeSpecs = [
    // ASK
    new TypeSpec(new TypeID("Alexa", "ASK", "Skill"), { namePropIncludesTypeName: false }),

    // AmazonMQ
    new TypeSpec(new TypeID("AWS", "AmazonMQ", "Broker")),
    new TypeSpec(new TypeID("AWS", "AmazonMQ", "Configuration"), { namePropIncludesTypeName: false }),

    // Amplify Console
    new TypeSpec(new TypeID("AWS", "Amplify", "App"), { namePropIncludesTypeName: false }),

    // API Gateway
    new  TypeSpec(new TypeID("AWS", "ApiGateway", "ApiKey"), { namePropIncludesTypeName: false }),
    new  TypeSpec(new TypeID("AWS", "ApiGateway", "VpcLink"), { namePropIncludesTypeName: false }),
    new  TypeSpec(new TypeID("AWS", "ApiGateway", "Authorizer"), { namePropIncludesTypeName: false }),
    new  TypeSpec(new TypeID("AWS", "ApiGateway", "RestApi"), { namePropIncludesTypeName: false }),
    new  TypeSpec(new TypeID("AWS", "ApiGateway", "UsagePlan")),

    // API Gateway V2
    new TypeSpec(new TypeID("AWS", "ApiGatewayV2", "Api"), { namePropIncludesTypeName: false }),
    new TypeSpec(new TypeID("AWS", "ApiGatewayV2", "Authorizer"), {  namePropIncludesTypeName: false }),
    new TypeSpec(new TypeID("AWS", "ApiGatewayV2", "Model"), { namePropIncludesTypeName: false }),

    // Application Auto Scaling
    new TypeSpec(new TypeID("AWS", "ApplicationAutoScaling", "ScalingPolicy"), { namePropReplacement: "PolicyName" }),

    // AppSync
    new TypeSpec(new TypeID("AWS", "AppSync", "DataSource"), { namePropIncludesTypeName: false }),
    new TypeSpec(new TypeID("AWS", "AppSync", "FunctionConfiguration"), { namePropIncludesTypeName: false }),
    new TypeSpec(new TypeID("AWS", "AppSync", "GraphQLApi"), { namePropIncludesTypeName: false }),

    // CloudWatch Logs
    new TypeSpec(new TypeID("AWS", "Logs", "Destination")),
    new TypeSpec(new TypeID("AWS", "Logs", "LogGroup")),
    new TypeSpec(new TypeID("AWS", "Logs", "LogStream")),

    // Code Build
    new TypeSpec(new TypeID("AWS", "CodeBuild", "Project"), { namePropIncludesTypeName: false }),

    // Code Pipeline
    new TypeSpec(new TypeID("AWS", "CodePipeline", "Pipeline"), { namePropIncludesTypeName: false }),

    // Amazon Cognito
    new TypeSpec(new TypeID("AWS", "Cognito", "IdentityPool")),
    new TypeSpec(new TypeID("AWS", "Cognito", "UserPool")),
    new TypeSpec(new TypeID("AWS", "Cognito", "UserPoolClient"), { namePropReplacement: "ClientName" }),

    // Lambda
    new TypeSpec(new TypeID("AWS", "Lambda", "Function")),

    // IAM
    new TypeSpec(new TypeID("AWS", "IAM", "Group")),
    new TypeSpec(new TypeID("AWS", "IAM", "InstanceProfile")),
    new TypeSpec(new TypeID("AWS", "IAM", "ManagedPolicy")),
    new TypeSpec(new TypeID("AWS", "IAM", "Policy")),
    new TypeSpec(new TypeID("AWS", "IAM", "Role")),
    new TypeSpec(new TypeID("AWS", "IAM", "User")),

    // Amazon S3
    new TypeSpec(new TypeID("AWS", "S3", "Bucket"), { nameConverter: val => val.replace(/_/g, ".") }), // s3 doesnt accept underscores, therefore replaces them by dots
];

class ServerlessAwsAutoResourceNamesPlugin {
    constructor(serverless, options) {
        this.environment = { serverless, options };

        if(this.isAwsTemplate) {
            this.hooks = {
                // rename functions on function deploy to prevent sls looking for the wrong name
                "before:deploy:function:initialize": () => {
                    Object.keys(this.service.functions).forEach((key) => {
                        const func = this.service.functions[key];
                        const spec = new TypeSpec(new TypeID("AWS", "Lambda", "Function"));

                        func.name = spec.getNameValue(this.config.prefix, key + "LambdaFunction");
                    });
                },
                // update the create template after it has been written
                "after:package:initialize": () => {
                    const filepath = path.join(this.serverless.config["servicePath"], ".serverless/cloudformation-template-create-stack.json");
                    this.applyOnJsonFile(filepath);
                },
                // update the create/update template in memory, from which the update template will be written to disk after
                "after:aws:package:finalize:mergeCustomProviderResources": () => {
                    this.applyOnResources(this.service["provider"]["compiledCloudFormationTemplate"]["Resources"]);
                    this.applyOnResources(this.service["provider"]["coreCloudFormationTemplate"]["Resources"]);
                },
            };

            // attach config initialization before each hook
            Object.keys(this.hooks).forEach((hook) => {
                const callback = this.hooks[hook];
                this.hooks[hook] = (...args) => { this.initializeConfig(); callback(...args); };
            });
        } else {
            this.log("template provider is not aws, therefore skipping transformations...");
        }
    }

    get serverless() {
        return this.environment.serverless;
    }

    get service() {
        return this.serverless.service;
    }

    get isAwsTemplate() {
        return this.service["provider"]["name"] === "aws";
    }

    applyPolicyNamesOnResource(resources, logicalName){
        const resource = resources[logicalName];
        const policies = resource.Properties && resource.Properties["Policies"];

        if(Array.isArray(policies)){
            for(let i = 0; i < policies.length; i++){
                policies[i]["PolicyName"] = "inline-policy-" + i;
            }
        }
    }

    applyOnResource(resources, logicalName){
        const resource = resources[logicalName];
        const templateResources = (this.service && this.service["resources"] && this.service["resources"]["Resources"]);

        // check if type is properly set
        if(!resource.Type){
            this.throwError(`property "Type" is missing on resource "${logicalName}"`);
        } else if(typeof resource.Type !== "string"){
            this.throwError(`property "Type" must be string on resource "${logicalName}"`);
        }

        // retrieve the resource provider and type name with a regex
        const { groups: { typeRoot, typeProvider, typeName } } = /^(?<typeRoot>\w*)::(?<typeProvider>\w*)::(?<typeName>\w*)$/.exec(resource.Type);

        // check type specs and applies the first that is applicable
        typeSpecs.some((spec) => {
            if(spec.isApplicable(new TypeID(typeRoot, typeProvider, typeName))){
                // make sure Properties field exists
                resource["Properties"] = resource["Properties"] || {};

                if(spec.isNameInserted()) {
                    let currName;

                    if(templateResources){
                        const templateResource = templateResources[logicalName];
                        currName = templateResource &&  templateResource.Properties && templateResource.Properties[spec.getNameProp()];
                    } else {
                        currName = resource.Properties[spec.getNameProp()];
                    }

                    // insert the name without overriding if already specified
                    resource.Properties[spec.getNameProp()] = currName || spec.getNameValue(this.config.prefix, logicalName);
                }

                return true;
            } else {
                return false;
            }
        })
    }

    applyOnResources(resources){
        Object.keys(resources).forEach((key) => {
            this.applyOnResource(resources, key);
            this.applyPolicyNamesOnResource(resources, key);
        });
    }

    applyOnJsonFile(path){
        const template = JSON.parse(fs.readFileSync(path).toString());
        const resources = template["Resources"];

        this.applyOnResources(resources);

        fs.writeFileSync(path, JSON.stringify(template, null, 2));
    }

    /**
     * throws formatted error with given message and logs optional passed error
     * @param {String} msg
     * @param {*?} err
     */
    throwError(msg, err){
        if(err){
            console.log("--- Error Log ---");
            console.log(err);
            console.log("-----------------");
        }

        throw new Error("Aws Auto Resource Names Error: " + msg);
    }

    log(msg){
        console.log("Aws Auto Resource Names Log: " + msg);
    }

    initializeConfig(){
        const custom = this.environment.serverless.service.custom;
        const { prefix = "" } = (custom && custom["awsAutoResourceNames"]) || {};

        // check prefix property
        if(typeof prefix !== "string"){
            this.throwError("prefix must be string");
        } else if(prefix.length === 0){
            this.throwError("prefix must be nonempty");
        }

        // set the generated config
        this.config = {
            prefix
        };
    }
}

module.exports = ServerlessAwsAutoResourceNamesPlugin;