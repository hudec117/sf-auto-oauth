# syntax=docker/dockerfile:1

FROM ubuntu:22.10

# Install node
RUN apt-get update && apt-get install -y curl unzip
RUN curl -sL https://deb.nodesource.com/setup_19.x | bash -
RUN apt-get update && apt-get install -y nodejs

# Install Google Chrome
RUN curl https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb --output ./google-chrome-stable_current_amd64.deb
RUN apt-get install ./google-chrome-stable_current_amd64.deb -y
RUN rm ./google-chrome-stable_current_amd64.deb

# Install Selenium Chrome Driver
RUN curl https://chromedriver.storage.googleapis.com/111.0.5563.64/chromedriver_linux64.zip --output ./chromedriver_linux64.zip
RUN unzip ./chromedriver_linux64.zip -d selenium-drivers
RUN rm ./chromedriver_linux64.zip
ENV PATH="$PATH:/selenium-drivers"

WORKDIR /app

COPY ["package.json", "package-lock.json*", "./"]

RUN npm install

COPY . .

ENV PORT=80
EXPOSE 80/tcp

CMD [ "node", "index.js" ]