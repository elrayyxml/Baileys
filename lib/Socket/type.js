const WAProto = require('../../WAProto').proto;
const crypto = require('crypto');
const Utils_1 = require("../Utils");

class elrayyxml {
    constructor(utils, waUploadToServer, relayMessageFn) {
        this.utils = utils;
        this.relayMessage = relayMessageFn
        this.waUploadToServer = waUploadToServer;
        
        this.bail = {
            generateWAMessageContent: this.utils.generateWAMessageContent || Utils_1.generateWAMessageContent,
            generateMessageID: Utils_1.generateMessageID,
            generateMessageIDV2: Utils_1.generateMessageIDV2,
            getContentType: (msg) => Object.keys(msg.message || {})[0]
        };
    }

    detectType(content) {
        if (content.requestPaymentMessage) return 'PAYMENT';
        if (content.productMessage) return 'PRODUCT';
        if (content.interactiveMessage) return 'INTERACTIVE';
        if (content.albumMessage) return 'ALBUM';
        if (content.eventMessage) return 'EVENT';
        if (content.pollResultMessage) return 'POLL_RESULT';
        if (content.groupStatusMessage) return 'GROUP_STORY';
        return null;
    }

    async handlePayment(content, quoted) {
        const data = content.requestPaymentMessage;
        let notes = {};

        if (data.sticker?.stickerMessage) {
            notes = {
                stickerMessage: {
                    ...data.sticker.stickerMessage,
                    contextInfo: {
                        stanzaId: quoted?.key?.id,
                        participant: quoted?.key?.participant || content.sender,
                        quotedMessage: quoted?.message
                    }
                }
            };
        } else if (data.note) {
            notes = {
                extendedTextMessage: {
                    text: data.note,
                    contextInfo: {
                        stanzaId: quoted?.key?.id,
                        participant: quoted?.key?.participant || content.sender,
                        quotedMessage: quoted?.message
                    }
                }
            };
        }

        const paymentContent = {
            requestPaymentMessage: WAProto.Message.RequestPaymentMessage.fromObject({
                expiryTimestamp: data.expiry || 0,
                amount1000: data.amount || 0,
                currencyCodeIso4217: data.currency || "IDR",
                requestFrom: data.from || "0@s.whatsapp.net",
                noteMessage: notes,
                background: data.background ?? {
                    id: "DEFAULT",
                    placeholderArgb: 0xFFF0F0F0
                }
            })
        };

        const msg = await this.utils.generateWAMessageFromContent(quoted?.key?.remoteJid || "0@s.whatsapp.net", paymentContent, { quoted });
        await this.relayMessage(msg.key.remoteJid, msg.message, {
            messageId: msg.key.id
        });
        return msg;
    }
        
    async handleProduct(content, jid, quoted) {
        const {
            title, 
            description, 
            thumbnail,
            productId, 
            retailerId, 
            url, 
            body = "", 
            footer = "", 
            buttons = [],
            priceAmount1000 = null,
            currencyCode = "IDR"
        } = content.productMessage;

        let productImage;

        if (Buffer.isBuffer(thumbnail)) {
            const { imageMessage } = await this.utils.generateWAMessageContent(
                { image: thumbnail }, 
                { upload: this.waUploadToServer }
            );
            productImage = imageMessage;
        } else if (typeof thumbnail === 'object' && thumbnail.url) {
            const { imageMessage } = await this.utils.generateWAMessageContent(
                { image: { url: thumbnail.url }}, 
                { upload: this.waUploadToServer }
            );
            productImage = imageMessage;
        }

        const productContent = {
            viewOnceMessage: {
                message: {
                    interactiveMessage: {
                        body: { text: body },
                        footer: { text: footer },
                        header: {
                            title,
                            hasMediaAttachment: true,
                            productMessage: {
                                product: {
                                    productImage,
                                    productId,
                                    title,
                                    description,
                                    currencyCode,
                                    priceAmount1000,
                                    retailerId,
                                    url,
                                    productImageCount: 1
                                },
                                businessOwnerJid: "0@s.whatsapp.net"
                            }
                        },
                        nativeFlowMessage: { buttons }
                    }
                }
            }
        };

        const msg = await this.utils.generateWAMessageFromContent(jid, productContent, { quoted });
        await this.relayMessage(jid, msg.message, {
            messageId: msg.key.id
        });
        return msg;
    }
    
    async handleInteractive(content, jid, quoted) {
        const {
            title,
            footer,
            thumbnail,
            image,
            video,
            document,
            mimetype,
            fileName,
            jpegThumbnail,
            contextInfo,
            externalAdReply,
            buttons = [],
            nativeFlowMessage,
            header
        } = content.interactiveMessage;

        let media = null;
        let mediaType = null;

        if (thumbnail) {
            media = await this.utils.prepareWAMessageMedia(
                { image: { url: thumbnail } },
                { upload: this.waUploadToServer }
            );
            mediaType = 'image';
        } else if (image) {
            if (typeof image === 'object' && image.url) {
                media = await this.utils.prepareWAMessageMedia(
                    { image: { url: image.url } },
                    { upload: this.waUploadToServer }
                );
            } else {
                media = await this.utils.prepareWAMessageMedia(
                    { image: image },
                    { upload: this.waUploadToServer }
                );
            }
            mediaType = 'image';
        } else if (video) {
            if (typeof video === 'object' && video.url) {
                media = await this.utils.prepareWAMessageMedia(
                    { video: { url: video.url } },
                    { upload: this.waUploadToServer }
                );
            } else {
                media = await this.utils.prepareWAMessageMedia(
                    { video: video },
                    { upload: this.waUploadToServer }
                );
            }
            mediaType = 'video';
        } else if (document) {
            let documentPayload = { 
                document: document 
            };
            if (jpegThumbnail) {
                if (typeof jpegThumbnail === 'object' && jpegThumbnail.url) {
                    documentPayload.jpegThumbnail = { url: jpegThumbnail.url };
                } else {
                    documentPayload.jpegThumbnail = jpegThumbnail;
                }
            }
            
            media = await this.utils.prepareWAMessageMedia(
                documentPayload,
                { upload: this.waUploadToServer }
            );
            if (fileName) {
                media.documentMessage.fileName = fileName;
            }
            if (mimetype) {
                media.documentMessage.mimetype = mimetype;
            }
            mediaType = 'document';
        }

        let interactiveMessage = {
            body: { text: title || "" },
            footer: { text: footer || "" }
        };

        if (buttons && buttons.length > 0) {
            interactiveMessage.nativeFlowMessage = {
                buttons: buttons
            };
            if (nativeFlowMessage) {
                interactiveMessage.nativeFlowMessage = {
                    ...interactiveMessage.nativeFlowMessage,
                    ...nativeFlowMessage
                };
            }
        } else if (nativeFlowMessage) {
            interactiveMessage.nativeFlowMessage = nativeFlowMessage;
        }
        
        if (media) {
            interactiveMessage.header = {
                title: header || "",
                hasMediaAttachment: true,
                ...media
            };
        } else {
            interactiveMessage.header = {
                title: header || "",        
                hasMediaAttachment: false
            };
        }
        
        let finalContextInfo = {};
        if (contextInfo) {
            finalContextInfo = {
                mentionedJid: contextInfo.mentionedJid || [],
                forwardingScore: contextInfo.forwardingScore || 0,
                isForwarded: contextInfo.isForwarded || false,
                ...contextInfo
            };
        }
        
        if (externalAdReply) {
            finalContextInfo.externalAdReply = {
                title: externalAdReply.title || "",
                body: externalAdReply.body || "",
                mediaType: externalAdReply.mediaType || 1,
                thumbnailUrl: externalAdReply.thumbnailUrl || "",
                mediaUrl: externalAdReply.mediaUrl || "",
                sourceUrl: externalAdReply.sourceUrl || "",
                showAdAttribution: externalAdReply.showAdAttribution || false,
                renderLargerThumbnail: externalAdReply.renderLargerThumbnail || false,
                ...externalAdReply
            };
        }
        
        if (Object.keys(finalContextInfo).length > 0) {
            interactiveMessage.contextInfo = finalContextInfo;
        }

        const interactiveContent = {
            interactiveMessage: interactiveMessage
        };

        const msg = await this.utils.generateWAMessageFromContent(jid, interactiveContent, { quoted });
        await this.relayMessage(jid, msg.message, {
            messageId: msg.key.id
        });
        return msg;
    }
    
    async handleAlbum(content, jid, quoted) {
        const array = content.albumMessage;
        
        const albumContent = {
            messageContextInfo: {
                messageSecret: crypto.randomBytes(32),
            },
            albumMessage: {
                expectedImageCount: array.filter((a) => a.hasOwnProperty("image")).length,
                expectedVideoCount: array.filter((a) => a.hasOwnProperty("video")).length,
            },
        };

        const albumMsg = await this.utils.generateWAMessageFromContent(jid, albumContent, {
            userJid: this.bail.generateMessageID().split('@')[0] + '@s.whatsapp.net',
            quoted,
            upload: this.waUploadToServer
        });
        
        await this.relayMessage(jid, albumMsg.message, {
            messageId: albumMsg.key.id,
        });
        
        for (let contentItem of array) {
            const mediaMsg = await this.utils.generateWAMessage(jid, contentItem, {
                upload: this.waUploadToServer,
            });
            
            mediaMsg.message.messageContextInfo = {
                messageSecret: crypto.randomBytes(32),
                messageAssociation: {
                    associationType: 1,
                    parentMessageKey: albumMsg.key,
                }
            };

            await this.relayMessage(jid, mediaMsg.message, {
                messageId: mediaMsg.key.id,
                quoted: {
                    key: albumMsg.key,
                    message: albumMsg.message,
                },
            });
        }
        
        return albumMsg;
    }   

    async handleEvent(content, jid, quoted) {
        const eventData = content.eventMessage;
        
        const eventContent = {
            viewOnceMessage: {
                message: {
                    messageContextInfo: {
                        deviceListMetadata: {},
                        deviceListMetadataVersion: 2,
                        messageSecret: crypto.randomBytes(32),
                    },
                    eventMessage: {
                        contextInfo: {
                            mentionedJid: [jid],
                        },
                        isCanceled: eventData.isCanceled || false,
                        name: eventData.name,
                        description: eventData.description,
                        location: eventData.location || {
                            degreesLatitude: 0,
                            degreesLongitude: 0,
                            name: "Location"
                        },
                        joinLink: eventData.joinLink || '',
                        startTime: typeof eventData.startTime === 'string' ? parseInt(eventData.startTime) : eventData.startTime || Date.now(),
                        endTime: typeof eventData.endTime === 'string' ? parseInt(eventData.endTime) : eventData.endTime || Date.now() + 3600000,
                        extraGuestsAllowed: eventData.extraGuestsAllowed !== false
                    }
                }
            }
        };

        const msg = await this.utils.generateWAMessageFromContent(jid, eventContent, { quoted });
        await this.relayMessage(jid, msg.message, {
            messageId: msg.key.id
        });
        return msg;
    }
    
    async handlePollResult(content, jid, quoted) {
        const pollData = content.pollResultMessage;
    
        const pollContent = {
            pollResultSnapshotMessage: {
                name: pollData.name,
                pollVotes: pollData.pollVotes.map(vote => ({
                    optionName: vote.optionName,
                    optionVoteCount: typeof vote.optionVoteCount === 'number' 
                    ? vote.optionVoteCount.toString() 
                    : vote.optionVoteCount
                }))
            }
        };

        const msg = await this.utils.generateWAMessageFromContent(jid, pollContent, {
            userJid: this.bail.generateMessageID().split('@')[0] + '@s.whatsapp.net',
            quoted
        });
    
        await this.relayMessage(jid, msg.message, {
            messageId: msg.key.id
        });

        return msg;
    }

    async handleGroupStory(content, jid, quoted) {
        const storyData = content.groupStatusMessage;
        
        let waMsgContent;
        if (storyData.message) {
            waMsgContent = storyData;
        } else {
            if (typeof this.bail?.generateWAMessageContent === "function") {
                waMsgContent = await this.bail.generateWAMessageContent(storyData, {
                    upload: this.waUploadToServer
                });
            } else {
                waMsgContent = await Utils_1.generateWAMessageContent(storyData, {
                    upload: this.waUploadToServer
                });
            }
        }

        const groupStoryContent = {
            groupStatusMessageV2: {
                message: waMsgContent.message || waMsgContent
            }
        };

        const msg = await this.utils.generateWAMessageFromContent(jid, groupStoryContent, {
            userJid: this.bail.generateMessageID().split('@')[0] + '@s.whatsapp.net',
            quoted
        });

        await this.relayMessage(jid, msg.message, {
            messageId: msg.key.id
        });

        return msg;
    }
}

module.exports = elrayyxml;
