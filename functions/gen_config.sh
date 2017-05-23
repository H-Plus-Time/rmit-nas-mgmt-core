sed -e 's/{{REPLACE_WITH_GOOGL_KEY}}/'$GOOGL_KEY'/g' ./config.template.js > ./config.js
sed -i 's/{{REPLACE_WITH_SENDGRID_KEY}}/'$SENDGRID_KEY'/g' ./config.js