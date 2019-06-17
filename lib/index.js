const { kebabCase } = require("change-case");
const fs = require("fs");
const path = require("path");

function identity(val) { return val; }

// defines behaviour when inserting the resource name for resources of a specific type provider and type name
class TypeBehaviourSpecification {
    /**
     * @param {String} typeProvider
     * @param {String} typeName
     * @param {Object?} options
     * @param {Function?} options.nameConverter - converts final name before usage
     * @param {Function?} options.logicalNameConverter - converts the logical name into the suffix used
     * @param {Boolean?} options.namePropIncludesTypeName - whether the type uses the type name when deciding the type name property
     * @param {Boolean?} options.noNameInsertion - whether auto generated name should be generated on this type
     */
    constructor(typeProvider, typeName, options = {}){
        const {
            nameConverter = identity,
            logicalNameConverter = kebabCase,
            namePropIncludesTypeName = true,
            noNameInsertion = false
        } = options;

        this.typeProvider = typeProvider;
        this.typeName = typeName;
        this.nameConverter = nameConverter;
        this.logicalNameConverter = logicalNameConverter;
        this.namePropIncludesTypeName = namePropIncludesTypeName;
        this.noNameInsertion = noNameInsertion;
    }

    /**
     * generates property name where the generated name value is inserted
     * @returns {string}
     */
    getNameProp(){
        return this.namePropIncludesTypeName ? this.typeName + "Name" : "Name";
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
     * checks if this specification applies for the given values
     * @param typeProvider
     * @param typeName
     * @returns {boolean}
     */
    isApplicable(typeProvider, typeName){
        return this.typeProvider === typeProvider && this.typeName === typeName;
    }

    /**
     * checks whether name insertion should be performed for this type
     */
    isNameInserted(){
        return !this.noNameInsertion;
    }
}

// list of custom type behaviour specifications
const customTypeBehaviours = [
    new TypeBehaviourSpecification("CodeBuild", "Project", { namePropIncludesTypeName: false }),
    new TypeBehaviourSpecification("CodePipeline", "Pipeline", { namePropIncludesTypeName: false }),
    new TypeBehaviourSpecification("Lambda", "Version", { noNameInsertion: true }),
    new TypeBehaviourSpecification("S3", "Bucket", { nameConverter: val => val.replace(/_/g, ".") }), // s3 doesnt accept underscores, therefore replaces them by dots
];

class ServerlessAwsAutoResourceNamesPlugin {
    constructor(serverless, options) {
        this.environment = { serverless, options };

        this.initializeConfig();

        if(this.isAwsTemplate) {
            this.hooks = {
                "before:deploy:function:initialize": () => {
                    Object.keys(this.service.functions).forEach((key) => {
                        const func = this.service.functions[key];
                        const spec = new TypeBehaviourSpecification("Lambda", "Function");

                        func.name = spec.getNameValue(this.config.prefix, key + "LambdaFunction");
                    });
                },
                "after:package:initialize": () => {
                    const filepath = path.join(this.serverless.config["servicePath"], ".serverless/cloudformation-template-create-stack.json");
                    this.applyOnJsonFile(filepath);
                },
                "after:aws:package:finalize:mergeCustomProviderResources": () => {
                    this.applyOnResources(this.service["provider"]["compiledCloudFormationTemplate"]["Resources"]);
                    this.applyOnResources(this.service["provider"]["coreCloudFormationTemplate"]["Resources"]);
                },
            }
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

        // check if type is properly set
        if(!resource.Type){
            this.throwError(`property "Type" is missing on resource "${logicalName}"`);
        } else if(typeof resource.Type !== "string"){
            this.throwError(`property "Type" must be string on resource "${logicalName}"`);
        }

        // retrieve the resource provider and type name with a regex
        const { groups: { typeProvider, typeName } } = /^AWS::(?<typeProvider>\w*)::(?<typeName>\w*)$/.exec(resource.Type);

        // use custom type behaviours and add the last as the default fallback
        const instanceTypeSpecifications = customTypeBehaviours.concat(new TypeBehaviourSpecification(typeProvider, typeName));

        // check type specs until some is applicable, which will at least be the last one
        instanceTypeSpecifications.some((spec) => {
            if(spec.isApplicable(typeProvider, typeName)){
                // make sure Properties field exists
                resource["Properties"] = resource["Properties"] || {};

                if(spec.isNameInserted()) {
                    // insert the name
                    resource.Properties[spec.getNameProp()] = spec.getNameValue(this.config.prefix, logicalName);
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