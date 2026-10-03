FROM nodered/node-red:latest

ARG SHACKCLOCK_VERSION=1.1.4
LABEL org.opencontainers.image.title="Node-RED ShackClock" \
      org.opencontainers.image.version="${SHACKCLOCK_VERSION}"
ENV SHACKCLOCK_VERSION="${SHACKCLOCK_VERSION}"

COPY --chown=node-red:node-red node-red/public/ /opt/shackclock/public/
COPY --chown=node-red:node-red node-red/defaults/ /opt/shackclock/defaults/
COPY --chown=node-red:node-red helpers/ /opt/shackclock/helpers/
COPY --chown=node-red:node-red docker/start-container.sh /opt/shackclock/start-container.sh

# satellite.js is used server-side for ISS propagation and in the browser for
# the optional amateur-satellite layer. Install one pinned copy under helpers.
USER root
RUN cd /opt/shackclock/helpers \
 && npm install --omit=dev --no-save satellite.js@6.0.2 mqtt@5.16.0 \
 && mkdir -p /opt/shackclock/public/vendor \
 && cp /opt/shackclock/helpers/node_modules/satellite.js/dist/satellite.min.js /opt/shackclock/public/vendor/satellite.min.js \
 && (cp /opt/shackclock/helpers/node_modules/satellite.js/LICENSE.md /opt/shackclock/public/vendor/satellite.LICENSE.txt 2>/dev/null || cp /opt/shackclock/helpers/node_modules/satellite.js/LICENSE /opt/shackclock/public/vendor/satellite.LICENSE.txt 2>/dev/null || true) \
 && chown -R node-red:node-red /opt/shackclock/helpers /opt/shackclock/public/vendor
USER node-red
RUN chmod +x /opt/shackclock/start-container.sh

EXPOSE 4040
ENTRYPOINT ["/opt/shackclock/start-container.sh"]
CMD ["npm","start","--","--userDir","/data"]
