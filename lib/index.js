const { kebabCase } = require("change-case");

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
     */
    constructor(typeProvider, typeName, options = {}){
        const {
            nameConverter = identity,
            logicalNameConverter = kebabCase,
            namePropIncludesTypeName = true
        } = options;

        this.typeProvider = typeProvider;
        this.typeName = typeName;
        this.nameConverter = nameConverter;
        this.logicalNameConverter = logicalNameConverter;
        this.namePropIncludesTypeName = namePropIncludesTypeName;
    }

    getNameProp(){
        return this.namePropIncludesTypeName ? this.typeName + "Name" : "Name";
    }

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
}

// list of custom type behaviour specifications
const customTypeBehaviours = [
    new TypeBehaviourSpecification("CodeBuild", "Project", { namePropIncludesTypeName: false }),
    new TypeBehaviourSpecification("CodePipeline", "Pipeline", { namePropIncludesTypeName: false }),
    new TypeBehaviourSpecification("S3", "Bucket", { nameConverter: val => val.replace(/_/g, ".") }), // s3 doesnt accept underscores, therefore replaces them by dots
];

class ServerlessAwsAutoResourceNamesPlugin {
    constructor(serverless, options) {
        this.environment = { serverless, options };

        this.hooks = {
            "aws:package:finalize:mergeCustomProviderResources": () => this.apply(),
        }
    }

    get template() {
        return this.environment.serverless["service"]["provider"]["compiledCloudFormationTemplate"];
    }

    get resources() {
        return this.template["Resources"];
    }

    applyOnResource(logicalName){
        const resource = this.resources[logicalName];

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

                // insert the name
                resource.Properties[spec.getNameProp()] = spec.getNameValue(this.config.prefix, logicalName);

                return true;
            } else {
                return false;
            }
        })
    }

    apply(){
        this.initializeConfig();

        Object.keys(this.resources).forEach((key) => {
           this.applyOnResource(key);
        });
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