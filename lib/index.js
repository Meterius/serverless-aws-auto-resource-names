const { kebabCase } = require("change-case");
const fs = require("fs");
const path = require("path");

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
            nameConverter = val => val,
            logicalNameConverter = (val) => kebabCase(val),
            namePropIncludesTypeName = true,
            noNameInsertion = false,
            namePropReplacement = undefined,
            ...rest
        } = options;

        if(Object.keys(rest).length > 0){
            throw new Error(JSON.stringify(Object.keys(rest)) + " Invalid TypeSpec Options");
        }

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
     * @param {String} prefix
     * @param {String} logicalName
     * @param {Object} pluginConfig - config object used in plugin
     * @returns {*}
     */
    getNameValue(prefix, logicalName, pluginConfig){
        return this.nameConverter(prefix + this.logicalNameConverter(logicalName, pluginConfig), pluginConfig);
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
     * applies name insertion
     * @param {Object} element - element on which name is inserted
     * @param {Object?} logicalElement - logical equivalent specified by the template
     * @param {String} prefix
     * @param {String} logicalName
     * @param {Object} pluginConfig - config object used in plugin
     */
    applyType(element, logicalElement, prefix, logicalName, pluginConfig){
        if(this.isNameInserted()){
            element[this.getNameProp()] = (logicalElement || {})[this.getNameProp()] || this.getNameValue(prefix, logicalName, pluginConfig);
        }
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
    new TypeSpec(new TypeID("AWS", "AppSync", "DataSource"), { namePropIncludesTypeName: false, nameConverter: val => val.replace(/-/g, "_") }),
    new TypeSpec(new TypeID("AWS", "AppSync", "FunctionConfiguration"), { namePropIncludesTypeName: false, nameConverter: val => val.replace(/-/g, "_") }),
    new TypeSpec(new TypeID("AWS", "AppSync", "GraphQLApi"), { namePropIncludesTypeName: false }),

    // CloudWatch Logs
    new TypeSpec(new TypeID("AWS", "Logs", "Destination")),
    new TypeSpec(new TypeID("AWS", "Logs", "LogGroup")),
    new TypeSpec(new TypeID("AWS", "Logs", "LogStream")),

    // Code Build
    new TypeSpec(new TypeID("AWS", "CodeBuild", "Project"), { namePropIncludesTypeName: false }),

    // Code Commit
    new TypeSpec(new TypeID("AWS", "CodeCommit", "Repository")),

    // Code Deploy
    new TypeSpec(new TypeID("AWS", "CodeDeploy", "Application")),
    new TypeSpec(new TypeID("AWS", "CodeDeploy", "DeploymentConfig")),
    new TypeSpec(new TypeID("AWS", "CodeDeploy", "DeploymentGroup")),

    // Code Pipeline
    new TypeSpec(new TypeID("AWS", "CodePipeline", "Pipeline"), { namePropIncludesTypeName: false }),

	// DynamoDB
	new TypeSpec(new TypeID("AWS", "DynamoDB", "Table")),

    // Amazon Cognito
    new TypeSpec(new TypeID("AWS", "Cognito", "IdentityPool")),
    new TypeSpec(new TypeID("AWS", "Cognito", "UserPool")),
    new TypeSpec(new TypeID("AWS", "Cognito", "UserPoolClient"), { namePropReplacement: "ClientName" }),

    // Lambda
    new TypeSpec(new TypeID("AWS", "Lambda", "Function"), {
        logicalNameConverter: (val, { removeLambdaFunctionSuffix }) => kebabCase(
            removeLambdaFunctionSuffix ? val.replace(/LambdaFunction$/, "") : val
        )
    }),
    new TypeSpec(new TypeID("AWS", "Lambda", "LayerVersion"), {
       namePropReplacement: "LayerName",
    }),

    // IAM
    new TypeSpec(new TypeID("AWS", "IAM", "Group")),
    new TypeSpec(new TypeID("AWS", "IAM", "InstanceProfile")),
    new TypeSpec(new TypeID("AWS", "IAM", "ManagedPolicy")),
    new TypeSpec(new TypeID("AWS", "IAM", "Policy")),
    new TypeSpec(new TypeID("AWS", "IAM", "Role")),
    new TypeSpec(new TypeID("AWS", "IAM", "User")),

    // Amazon S3
    new TypeSpec(new TypeID("AWS", "S3", "Bucket"), { nameConverter: val => val.replace(/_/g, "-").replace(/\./g, "-") }),
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
                        const spec = typeSpecs.find(spec => spec.isApplicable(new TypeID("AWS", "Lambda", "Function")));
                        func.name = spec.getNameValue(this.config.prefix, key + "LambdaFunction", this.config);
                    });

                    this.applyOnCloudFormationTemplate(this.service.resources, this.service);
                },
                // update the create template after it has been written
                "after:package:initialize": () => {
                    const filepath = path.join(this.serverless.config["servicePath"], ".serverless/cloudformation-template-create-stack.json");
                    this.applyOnJsonFile(filepath, this.service);
                },
                // update the create/update template in memory, from which the update template will be written to disk after
                "after:aws:package:finalize:mergeCustomProviderResources": () => {
                    this.applyOnCloudFormationTemplate(this.service["provider"]["compiledCloudFormationTemplate"], this.service);
                    this.applyOnCloudFormationTemplate(this.service["provider"]["coreCloudFormationTemplate"], this.service);
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

    applyOnResource(resources, templateResources, logicalName){
        const resource = resources[logicalName];
        const templateResource = (templateResources || {})[logicalName] || {};

        // check if type is properly set
        if(!resource.Type){
            this.throwError(`property "Type" is missing on resource "${logicalName}"`);
        } else if(typeof resource.Type !== "string"){
            this.throwError(`property "Type" must be string on resource "${logicalName}"`);
        }

        // retrieve the resource provider and type name with a regex
        const { groups: { typeRoot, typeProvider, typeName } } = /^(?<typeRoot>\w*)::(?<typeProvider>\w*)::(?<typeName>\w*)$/.exec(resource.Type);

        // check type specs and applies the first that is applicable
        typeSpecs.forEach((spec) => {
            if(spec.isApplicable(new TypeID(typeRoot, typeProvider, typeName))){
                // make sure Properties field exists
                resource["Properties"] = resource["Properties"] || {};

                spec.applyType(resource["Properties"], templateResource["Properties"], this.config.prefix, logicalName, this.config);

                return true;
            } else {
                return false;
            }
        })
    }

    applyOnOutput(outputs, logicalName){
        const output = outputs[logicalName];
        output["Export"] = output["Export"] || {};

        if(output["Export"]) {
            const spec = new TypeSpec(new TypeID("CUSTOM", "Output", "Export"), {namePropIncludesTypeName: false});

            spec.applyType(output["Export"], output["Export"], this.config.exportPrefix || this.config.prefix, logicalName, this.config);
        }
    }

    applyOnCloudFormationTemplate(cfTemplate, template){
        const resources = cfTemplate["Resources"] || {};
        const templateResources = (template["resources"] || {})["Resources"];

        Object.keys(resources).forEach((key) => {
            this.applyOnResource(resources, templateResources, key);
        });

        if(this.config.generateExports) {
            const outputs = cfTemplate["Outputs"] || {};

            Object.keys(outputs).forEach((key) => {
                this.applyOnOutput(outputs, key);
            });
        }
    }

    applyOnJsonFile(path, template){
        const cfTemplate = JSON.parse(fs.readFileSync(path).toString());
        this.applyOnCloudFormationTemplate(cfTemplate, template);
        fs.writeFileSync(path, JSON.stringify(cfTemplate, null, 2));
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
        const { prefix = "", exportPrefix = undefined, generateExports = false, removeLambdaFunctionSuffix = true } = (custom && custom["awsAutoResourceNames"]) || {};

        // check prefix property
        if(typeof prefix !== "string"){
            this.throwError("prefix must be string");
        } else if(prefix.length === 0){
            this.throwError("prefix must be nonempty");
        }

        // check export prefix property
        if(exportPrefix !== undefined && typeof exportPrefix !== "string"){
            this.throwError("output prefix must be string");
        } else if(exportPrefix !==  undefined && exportPrefix.length === 0){
            this.throwError("output prefix must be non empty or undefined");
        }

        // check lambda function suffix removal property
        if(typeof removeLambdaFunctionSuffix !== "boolean"){
            this.throwError("remove lambda function suffix must be a boolean");
        }

        // set the generated config
        this.config = {
            prefix, exportPrefix, generateExports, removeLambdaFunctionSuffix
        };
    }
}

module.exports = ServerlessAwsAutoResourceNamesPlugin;
