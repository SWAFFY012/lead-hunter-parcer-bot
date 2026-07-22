set appPath to "/Applications/Project /whatsap-parser"
do shell script "export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH; cd '" & appPath & "' && nohup npm run launcher > /dev/null 2>&1 &"
