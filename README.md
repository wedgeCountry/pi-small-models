
# Pi Coding Agent Extensions for usage of weaker models

I realized that some weaker models, such as gemma4-e4b, are struggling with the default implementations of edit and bash.
Also they have problems dealing in windows environments.

The solution I found was to give them very basic tools instead of bash and simplify the edit tool.