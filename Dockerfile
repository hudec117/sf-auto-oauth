# syntax=docker/dockerfile:1

FROM ubuntu:22.04

# Install node
# Reference: https://github.com/nodesource/distributions#debian-and-ubuntu-based-distributions
RUN apt-get update && apt-get install -y ca-certificates curl gnupg
RUN mkdir -p /etc/apt/keyrings
RUN curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
RUN echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list
RUN cat /etc/apt/sources.list.d/nodesource.list
RUN apt-get update && apt-get install nodejs -y

# Install CfT Dependencies
RUN apt-get -y install libglib2.0-0 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libdbus-1-3 libxcb1 libxkbcommon-x11-0 libasound2 libcairo2 libpango-1.0-0 libgbm1 libxrandr2 libxfixes3 libxdamage1 libxcomposite1

# Install Chrome for Testing
# Reference: https://googlechromelabs.github.io/chrome-for-testing/
RUN npx @puppeteer/browsers install chrome@116.0.5845.96
ENV PATH="$PATH:/chrome/linux-116.0.5845.96/chrome-linux64"

# Install Selenium Chrome Driver
RUN apt-get install -y unzip
RUN curl https://edgedl.me.gvt1.com/edgedl/chrome/chrome-for-testing/116.0.5845.96/linux64/chromedriver-linux64.zip --output ./chromedriver-linux64.zip
RUN unzip ./chromedriver-linux64.zip -d .
RUN rm ./chromedriver-linux64.zip
ENV PATH="$PATH:/chromedriver-linux64"

WORKDIR /app

COPY ["package.json", "package-lock.json*", "./"]

RUN npm install

COPY . .

ENV PORT=80
EXPOSE 80/tcp

CMD [ "node", "index.js" ]