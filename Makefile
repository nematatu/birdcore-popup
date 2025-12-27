ZIP_NAME := bird-popup.zip
FILES := manifest.json popup.html popup.css popup.js team-aliases.json court-youtube.json icons

.PHONY: zip clean

zip:
	zip -r $(ZIP_NAME) $(FILES)

clean:
	rm -f $(ZIP_NAME)
